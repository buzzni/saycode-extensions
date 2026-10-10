import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'
import JSZip from 'jszip'

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')

test('scaffold, validate, dev, and pack create an installable browser extension', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-cli-'))
  const project = join(temporary, 'hello-world')
  const archive = join(temporary, 'hello.saycode-extension')
  try {
    await exec('node', [cli, 'scaffold', project, '--id', 'buzzni.hello'])
    await exec('npm', ['install', join(root, 'packages/sdk')], { cwd: project })
    await exec('node', [cli, 'validate', project])
    await exec('node', [cli, 'dev', project, '--once'])
    await access(join(project, '.saycode/dev/index.js'))
    await exec('node', [cli, 'pack', project, '--output', archive])

    const zip = await JSZip.loadAsync(await readFile(archive))
    assert.ok(zip.file('extension.json'))
    assert.ok(zip.file('index.js'))
    const manifest = JSON.parse(await zip.file('extension.json').async('string'))
    assert.equal(manifest.id, 'buzzni.hello')
    assert.equal(manifest.apiVersion, 3)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('browser build rejects Node ambient authority', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-cli-deny-'))
  try {
    await exec('node', [cli, 'scaffold', temporary, '--id', 'buzzni.denied'])
    await writeFile(join(temporary, 'src/index.ts'), "import { readFileSync } from 'node:fs'; readFileSync('/etc/passwd')")
    await assert.rejects(exec('node', [cli, 'pack', temporary]), /node:fs|Could not resolve/)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('pack includes declared project-template asset trees', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-template-pack-'))
  const archive = join(temporary, 'templates.saycode-extension')
  try {
    await mkdir(join(temporary, 'src'), { recursive: true })
    await mkdir(join(temporary, 'templates/dashboard/src'), { recursive: true })
    await writeFile(join(temporary, 'src/index.ts'), 'export default { activate() {} }')
    await writeFile(join(temporary, 'templates/dashboard/src/App.tsx'), 'export function App() {}')
    await writeFile(join(temporary, 'extension.json'), JSON.stringify({
      id: 'buzzni.templates', version: '1.0.0', apiVersion: 2,
      engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
      contributes: {
        projectTemplates: [{ id: 'buzzni.templates.dashboard', title: 'Dashboard', assetsRoot: 'templates/dashboard' }],
      },
    }))

    await exec('node', [cli, 'pack', temporary, '--output', archive])

    const zip = await JSZip.loadAsync(await readFile(archive))
    assert.equal(await zip.file('templates/dashboard/src/App.tsx').async('string'), 'export function App() {}')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('pack includes each declared panel entrypoint', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-panel-pack-'))
  const archive = join(temporary, 'panel.saycode-extension')
  try {
    await mkdir(join(temporary, 'src'), { recursive: true })
    await writeFile(join(temporary, 'src/index.ts'), 'export default { activate() {} }')
    await writeFile(join(temporary, 'panel.html'), '<h1>Panel</h1>')
    await writeFile(join(temporary, 'extension.json'), JSON.stringify({
      id: 'buzzni.panel', version: '1.0.0', apiVersion: 2,
      engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
      contributes: {
        panels: [{ id: 'buzzni.panel.main', title: 'Panel', entrypoint: 'panel.html' }],
      },
    }))

    await exec('node', [cli, 'pack', temporary, '--output', archive])

    const zip = await JSZip.loadAsync(await readFile(archive))
    assert.equal(await zip.file('panel.html').async('string'), '<h1>Panel</h1>')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

async function packPanel(panel) {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-panel-check-'))
  const archive = join(temporary, 'panel.saycode-extension')
  try {
    await mkdir(join(temporary, 'src'), { recursive: true })
    await writeFile(join(temporary, 'src/index.ts'), 'export default { activate() {} }')
    await writeFile(join(temporary, 'panel.html'), panel)
    await writeFile(join(temporary, 'extension.json'), JSON.stringify({
      id: 'buzzni.panel', version: '1.0.0', apiVersion: 2,
      engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
      contributes: { panels: [{ id: 'buzzni.panel.main', title: 'Panel', entrypoint: 'panel.html' }] },
    }))
    try {
      await exec('node', [cli, 'pack', temporary, '--output', archive])
      return { packed: true, stderr: '' }
    } catch (error) {
      return { packed: false, stderr: String(error.stderr) }
    }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

// Desktop renders panels under a CSP that allows only inline script/style and reads at most 512 KiB of
// strict UTF-8; anything else installs fine and then shows a blank panel.
test('pack refuses a panel that loads scripts or stylesheets from separate files', async () => {
  for (const html of [
    '<div id="app"></div><script type="module" crossorigin src="./assets/index-4f2a.js"></script>',
    '<link rel="stylesheet" href="./assets/index.css"><div id="app"></div>',
    '<link rel="modulepreload" crossorigin href="./assets/vendor.js"><script type="module">import "./assets/vendor.js"</script>',
  ]) {
    const result = await packPanel(html)
    assert.equal(result.packed, false, html)
    assert.match(result.stderr, /panel\.html.*inline/i)
  }
})

test('pack refuses a panel over the 512 KiB Desktop limit or not valid UTF-8', async () => {
  const large = await packPanel(`<script>${'x'.repeat(512 * 1024)}</script>`)
  assert.equal(large.packed, false)
  assert.match(large.stderr, /panel\.html.*512 KiB/)
  const binary = await packPanel(Buffer.from([0x3c, 0x70, 0x3e, 0xff, 0xfe, 0x3c, 0x2f, 0x70, 0x3e]))
  assert.equal(binary.packed, false)
  assert.match(binary.stderr, /panel\.html.*UTF-8/)
})

test('pack accepts a single-file build with inline module script and style', async () => {
  const result = await packPanel('<!doctype html><html><head><script type="module" crossorigin>const a = document.createElement("div");document.body.append(a)</script><style>.p-4{padding:1rem}</style></head><body></body></html>')
  assert.equal(result.packed, true, result.stderr)
})

test('pack writes byte-for-byte deterministic archives for the same inputs', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-extension-deterministic-pack-'))
  const first = join(temporary, 'first.saycode-extension')
  const second = join(temporary, 'second.saycode-extension')
  try {
    await mkdir(join(temporary, 'src'), { recursive: true })
    await writeFile(join(temporary, 'src/index.ts'), 'export default { activate() {} }')
    await writeFile(join(temporary, 'extension.json'), JSON.stringify({
      id: 'buzzni.deterministic', version: '1.0.0', apiVersion: 2,
      engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
      contributes: {},
    }))

    await exec('node', [cli, 'pack', temporary, '--output', first])
    await new Promise((resolve) => setTimeout(resolve, 2_100))
    await exec('node', [cli, 'pack', temporary, '--output', second])

    assert.deepEqual(await readFile(first), await readFile(second))
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
