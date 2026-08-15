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
      id: 'buzzni.templates', version: '1.0.0', apiVersion: 1,
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
