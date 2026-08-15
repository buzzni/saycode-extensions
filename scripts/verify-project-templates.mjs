import { execFile } from 'node:child_process'
import { cp, mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const sourceRoot = new URL('../packages/project-templates/templates', import.meta.url).pathname
const templateIds = ['dashboard', 'survey-form', 'api-backoffice']

function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') return reject(new Error('could not allocate a dev server port'))
      server.close((error) => error ? reject(error) : resolve(address.port))
    })
  })
}

async function waitForDevServer(url, child, output) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`dev server exited early (${child.exitCode}):\n${output()}`)
    try {
      const response = await fetch(url)
      if (response.ok && (await response.text()).includes('<div id="root"></div>')) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`dev server did not become ready: ${url}\n${output()}`)
}

async function stop(child, closed) {
  if (child.exitCode !== null) return
  child.kill('SIGTERM')
  const exited = await Promise.race([
    closed.then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 5_000)),
  ])
  if (!exited) {
    child.kill('SIGKILL')
    await closed
  }
}

async function verifyTemplate(templateId) {
  const temporary = await mkdtemp(join(tmpdir(), `saycode-template-${templateId}-`))
  const project = join(temporary, templateId)
  try {
    await cp(join(sourceRoot, templateId), project, { recursive: true })
    await exec('npm', ['install', '--ignore-scripts'], { cwd: project })
    await exec('npm', ['run', 'build'], { cwd: project })
    const port = await availablePort()
    const child = execFile(join(project, 'node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
      cwd: project,
    })
    let output = ''
    child.stdout?.on('data', (chunk) => { output += String(chunk) })
    child.stderr?.on('data', (chunk) => { output += String(chunk) })
    const closed = new Promise((resolve) => child.once('close', resolve))
    try {
      await waitForDevServer(`http://127.0.0.1:${port}`, child, () => output)
    } finally {
      await stop(child, closed)
    }
    console.log(`verified ${templateId}: install, build, dev`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

for (const templateId of templateIds) await verifyTemplate(templateId)
