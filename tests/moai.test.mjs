import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import JSZip from 'jszip'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'
import { createTestHost } from '../packages/test-host/dist/index.js'

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')

const manifest = JSON.parse(await readFile(new URL('../packages/moai/extension.json', import.meta.url)))
const lifecycle = JSON.parse(await readFile(new URL('./fixtures/moai/lifecycle.json', import.meta.url)))

/**
 * The extension as shipped: packed by the CLI (which compiles src/index.ts), then read back out of the
 * archive. Nothing here depends on a prior workspace build, so a clean release checkout behaves the same.
 */
async function packMoai() {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-moai-'))
  try {
    const archivePath = join(temporary, 'moai.saycode-extension')
    await exec('node', [cli, 'pack', join(root, 'packages/moai'), '--output', archivePath])
    const zip = await JSZip.loadAsync(await readFile(archivePath))
    const modulePath = join(temporary, 'index.mjs')
    await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
    const extension = (await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)).default
    return { extension, panelHtml: await zip.file('panel.html').async('string') }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const packed = await packMoai()
const extension = packed.extension
const packedPanelHtml = async () => packed.panelHtml

test('Moai fixture covers install, approval, and rollback lifecycle expectations', () => {
  assert.equal(lifecycle.install.initialState, 'disabled')
  assert.deepEqual(lifecycle.approval, { permission: 'machine.run', required: true })
  assert.equal(lifecycle.rollback.preservesLastKnownGood, true)
})

test('Moai manifest declares only bounded v0.8.0 managed profiles', () => {
  const parsed = parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
  assert.deepEqual(parsed.machineCommands.profiles.map((profile) => profile.id), lifecycle.run.profiles)
  for (const profile of parsed.machineCommands.profiles) {
    assert.equal(profile.executable, 'moai')
    // Mirrors the Happy daemon's host-owned Moai v0.8.0 catalog verbatim: the daemon runs a
    // profile only when this declaration hashes to the digest it ships.
    assert.deepEqual(profile.envAllowlist, ['HOME'])
    assert.deepEqual(profile.descendantAllowlist, ['git'])
    assert.equal(profile.timeoutMs, 120000)
    assert.equal(profile.outputLimitBytes, 1048576)
    assert.equal(profile.stdin, 'none')
    assert.ok(profile.argv.includes('--json'))
    assert.doesNotMatch(profile.argv.join(' '), /init|tui|wake|hooks|editor|shell/i)
  }
})

test('Moai extension forwards approved run, status, and cancel calls', async () => {
  const calls = []
  const host = createTestHost('buzzni.moai', {
    async invokeCapability(permission, action, args) {
      calls.push({ permission, action, args })
      if (action === 'start') return { action, operationId: 'moai-op-1', state: 'accepted' }
      if (action === 'status') return { action, operationId: args.operationId, state: 'running' }
      return { action, operationId: args.operationId, state: 'cancelled' }
    },
  })
  await host.activate(extension)
  assert.deepEqual(await host.invokeCommand('buzzni.moai.run', ['buzzni.moai.status']), { action: 'start', operationId: 'moai-op-1', state: 'accepted' })
  assert.deepEqual(await host.invokeCommand('buzzni.moai.status', ['moai-op-1']), { action: 'status', operationId: 'moai-op-1', state: 'running' })
  assert.deepEqual(await host.invokeCommand('buzzni.moai.cancel', ['moai-op-1']), { action: 'cancel', operationId: 'moai-op-1', state: 'cancelled' })
  assert.deepEqual(calls, [
    { permission: 'machine.run', action: 'start', args: { profileId: 'buzzni.moai.status', parameters: {} } },
    { permission: 'machine.run', action: 'status', args: { operationId: 'moai-op-1' } },
    { permission: 'machine.run', action: 'cancel', args: { operationId: 'moai-op-1' } },
  ])
})

class FakeElement {
  textContent = ''
  value = ''
  disabled = false
  hidden = false
  children = []
  listeners = new Map()
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(type, listener) { this.listeners.set(type, listener) }
  dispatch(type, fields = {}) { this.listeners.get(type)?.({ target: this, preventDefault() {}, ...fields }) }
}

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)) }
const PANEL_IDS = ['title', 'hint', 'check', 'task', 'add', 'cancel', 'status', 'error', 'result']


function inlineScript(html) {
  const start = html.lastIndexOf('<script>')
  const end = html.indexOf('</script>', start)
  assert.ok(start >= 0 && end > start, 'panel.html keeps one inline script')
  return html.slice(start + '<script>'.length, end)
}

async function runPanel(invokeCommand, language = 'en') {
  const script = inlineScript(await packedPanelHtml())
  const ids = Object.fromEntries(PANEL_IDS.map((id) => [id, new FakeElement()]))
  const document = { documentElement: { lang: language }, getElementById: (id) => ids[id], createElement: () => new FakeElement() }
  Function('window', 'document', 'navigator', script)({ saycodePanel: { ready: Promise.resolve(), invokeCommand } }, document, { language: 'en' })
  await flush()
  return ids
}

test('a machine action opens the Moai board panel through a command declared by the extension', async () => {
  const parsed = parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
  const open = parsed.contributes.commands.find((command) => command.id === 'buzzni.moai.open')
  assert.equal(open?.panelId, 'buzzni.moai.panel')
  assert.deepEqual(parsed.contributes.panels, [{ id: 'buzzni.moai.panel', title: 'Moai', entrypoint: 'panel.html' }])
  assert.deepEqual(parsed.contributes.machineActions, [{ id: 'buzzni.moai.board', title: 'Moai', command: 'buzzni.moai.open', when: { online: true } }])
  assert.ok(parsed.activationEvents.includes('onCommand:buzzni.moai.open'))
  const host = createTestHost('buzzni.moai', { async invokeCapability() { throw new Error('not expected') } })
  await host.activate(extension)
  assert.equal(await host.invokeCommand('buzzni.moai.open', [{ version: 1, machine: { id: 'm1', online: true } }]), null)
})

test('the board shows task counts from a status run, polling until it finishes', async () => {
  const calls = []
  let polls = 0
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-1', state: 'accepted' }
    polls += 1
    return polls < 2
      ? { action: 'status', operationId: 'op-1', state: 'running' }
      : { action: 'status', operationId: 'op-1', state: 'passed', stdout: JSON.stringify({ counts: { todo: 3, in_progress: 1, review: 0, done: 5 }, total: 9 }), exitCode: 0 }
  })
  elements.check.dispatch('click')
  await flush()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.status']])
  assert.deepEqual(calls.slice(1).map(([command, args]) => [command, args]), [['buzzni.moai.status', ['op-1']], ['buzzni.moai.status', ['op-1']]])
  assert.equal(elements.result.textContent, 'To do 3 · In progress 1 · Review 0 · Done 5')
  assert.equal(elements.error.textContent, '')
  assert.equal(elements.check.disabled, false)
})

test('adding a task needs a title and reports the created task', async () => {
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-2', state: 'accepted' }
    return { action: 'status', operationId: 'op-2', state: 'passed', stdout: JSON.stringify({ id: 'shop-7', title: 'Fix checkout', status: 'todo' }), exitCode: 0 }
  }, 'ko')
  elements.add.dispatch('click')
  await flush()
  assert.equal(calls.length, 0)
  assert.equal(elements.error.textContent, '할 일 제목을 입력하세요.')
  elements.task.value = '  Fix checkout  '
  elements.add.dispatch('click')
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.add', 'Fix checkout']])
  assert.equal(elements.result.textContent, '추가했습니다: Fix checkout (shop-7)')
  assert.equal(elements.task.value, '')
})

test('a refused or unsupported start is explained and leaves the board usable', async () => {
  const elements = await runPanel(async () => { throw new Error('capability.invoke machine.run/start failed: binding-mismatch') })
  elements.check.dispatch('click')
  await flush()
  assert.equal(elements.error.textContent, 'The run did not start. It may have been declined, or this machine does not support Moai yet.')
  assert.equal(elements.check.disabled, false)
  assert.equal(elements.add.disabled, false)
})

test('a failed run shows the reason Moai gave', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-3', state: 'accepted' }
    : { action: 'status', operationId: 'op-3', state: 'failed', stdout: JSON.stringify({ code: 'no_actor', error: 'the git user details are not there' }), exitCode: 1 })
  elements.task.value = 'Write docs'
  elements.add.dispatch('click')
  await flush()
  assert.equal(elements.error.textContent, 'Moai reported an error: the git user details are not there')
})

test('the board follows the host document language and only talks to its own commands', async () => {
  const elements = await runPanel(async () => null, 'ja')
  assert.equal(elements.title.textContent, 'Moai 作業ボード')
  const html = await packedPanelHtml()
  for (const command of html.matchAll(/invokeCommand\('([^']+)'/g)) assert.match(command[1], /^buzzni\.moai\./)
  assert.doesNotMatch(html, /electron|ipcRenderer|innerHTML/)
})

// Real Moai v0.8.0 output: errors go to stderr, and status outside a `.moai/` repository lists projects instead of counts.
const NOT_A_REPOSITORY = JSON.stringify({ code: 'error', error: 'Not a moai repository (no `.moai/` found). Start one with `moai init`, or call a repository elsewhere with `moai -C <dir> <command>`' })
const NOT_INITIALIZED_EN = 'This project has no Moai board yet. On that machine, run `moai init` once in the project folder, then try again.'

test('adding to a project without a Moai board explains how to start one', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-4', state: 'accepted' }
    : { action: 'status', operationId: 'op-4', state: 'failed', stdout: '', stderr: NOT_A_REPOSITORY, exitCode: 1 })
  elements.task.value = 'Write docs'
  elements.add.dispatch('click')
  await flush()
  assert.equal(elements.error.textContent, NOT_INITIALIZED_EN)
})

test('status in a project without a Moai board explains how to start one', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-5', state: 'accepted' }
    : { action: 'status', operationId: 'op-5', state: 'passed', stdout: JSON.stringify({ projects: [], problems: [], config: '/home/me/.config/moai/config.toml' }), stderr: '', exitCode: 0 }, 'ko')
  elements.check.dispatch('click')
  await flush()
  assert.equal(elements.error.textContent, '이 프로젝트에는 아직 Moai 보드가 없습니다. 그 머신의 프로젝트 폴더에서 `moai init`을 한 번 실행한 뒤 다시 시도하세요.')
  assert.equal(elements.result.textContent, '')
})

test('a failed run shows the reason Moai printed on stderr', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-6', state: 'accepted' }
    : { action: 'status', operationId: 'op-6', state: 'failed', stdout: '', stderr: JSON.stringify({ code: 'no_actor', error: 'the git user details are not there' }), exitCode: 1 })
  elements.task.value = 'Write docs'
  elements.add.dispatch('click')
  await flush()
  assert.equal(elements.error.textContent, 'Moai reported an error: the git user details are not there')
})

test('Enter in the title field adds the task, since the sandboxed panel cannot submit forms', async () => {
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-7', state: 'accepted' }
    return { action: 'status', operationId: 'op-7', state: 'passed', stdout: JSON.stringify({ id: 'm1-x', title: 'Ship it', status: 'todo' }), exitCode: 0 }
  })
  elements.task.value = 'Ship it'
  elements.task.dispatch('keydown', { key: 'Enter', isComposing: false })
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.add', 'Ship it']])
  // An IME composing Hangul also reports Enter; that keystroke must not add the half-typed title.
  calls.length = 0
  elements.task.value = '한글'
  elements.task.dispatch('keydown', { key: 'Enter', isComposing: true })
  await flush()
  assert.equal(calls.length, 0)
  assert.doesNotMatch(await packedPanelHtml(), /<form|'submit'/)
})

test('a cancel ends the run at once and says when processes may still be running on the machine', async () => {
  // The Happy runner never reports a cancelled group reaped on macOS, so the board must not wait for it;
  // the daemon's workspace write lock refuses an overlapping write until the old group settles.
  const calls = []
  const elements = await runPanel(async (command) => {
    calls.push(command)
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-8', state: 'accepted' }
    return { action: 'status', operationId: 'op-8', state: 'cancelled', remoteMayContinue: true, descendantsReaped: false }
  }, 'ko')
  elements.check.dispatch('click')
  await flush()
  assert.deepEqual(calls, ['buzzni.moai.run', 'buzzni.moai.status'])
  assert.equal(elements.status.textContent, '실행을 취소했습니다. 머신에서 프로세스가 아직 끝나지 않았을 수 있습니다.')
  assert.equal(elements.error.textContent, '')
  assert.equal(elements.check.disabled, false)
  assert.equal(elements.add.disabled, false)
})

test('a cancel whose processes are reaped says only that the run was cancelled', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-9', state: 'accepted' }
    : { action: 'status', operationId: 'op-9', state: 'cancelled', remoteMayContinue: false, descendantsReaped: true })
  elements.check.dispatch('click')
  await flush()
  assert.equal(elements.status.textContent, 'The run was cancelled.')
})
