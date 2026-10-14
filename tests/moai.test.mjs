import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { JSDOM } from 'jsdom'
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
    // The panel is built from panel/ into dist/panel.html first, as `npm run pack` does.
    await exec('node', [join(root, 'packages/moai/build.mjs')])
    await exec('node', [cli, 'pack', join(root, 'packages/moai'), '--output', archivePath])
    const zip = await JSZip.loadAsync(await readFile(archivePath))
    const modulePath = join(temporary, 'index.mjs')
    await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
    const extension = (await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)).default
    return { extension, panelHtml: await zip.file('dist/panel.html').async('string'), files: Object.keys(zip.files) }
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

const packed = await packMoai()
const extension = packed.extension

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

test('a refused start comes back as a result with its code, so the panel can explain it', async () => {
  // The panel bridge carries only an error message, so the command returns the refusal instead of throwing it.
  let failure
  const host = createTestHost('buzzni.moai', { async invokeCapability() { throw failure } })
  await host.activate(extension)
  failure = Object.assign(new Error('capability.invoke machine.run/start failed: declined'), { code: 'declined' })
  assert.deepEqual(await host.invokeCommand('buzzni.moai.run', ['buzzni.moai.status']), { action: 'start', state: 'refused', code: 'declined' })
  failure = Object.assign(new Error('busy'), { code: 'workspace-busy' })
  assert.deepEqual(await host.invokeCommand('buzzni.moai.run', ['buzzni.moai.add', 'Ship it']), { action: 'start', state: 'refused', code: 'workspace-busy' })
  // Unknown or missing codes stay failures, as before.
  failure = Object.assign(new Error('later'), { code: 'something-new' })
  await assert.rejects(host.invokeCommand('buzzni.moai.run', ['buzzni.moai.status']), /later/)
  failure = new Error('capability failed')
  await assert.rejects(host.invokeCommand('buzzni.moai.run', ['buzzni.moai.status']), /capability failed/)
})


const flush = async () => { for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve)) }
const panelWindows = []
// Each test closes its panels: the 60 s refresh timer would otherwise hold the process open (root `after`
// hooks wait for an idle event loop). A read that settles after its window closed would still start that
// timer, so a window stops taking timers before it closes.
afterEach(() => { for (const window of panelWindows.splice(0)) { window.stopTimers(); window.close() } })

const fixture = async (name) => readFile(new URL(`./fixtures/moai/${name}`, import.meta.url), 'utf8')
// Real Moai v0.8.0 output, read up front: file I/O inside a handler would outlast the panel's flushes.
const PRIME = await fixture('prime-v080.json')
const PRIME_NO_TRACKER = await fixture('prime-no-tracker-v080.json')
const SHOW_NOTE_BODY = await fixture('show-note-body-v080.json')
const SHOW_MOVED = await fixture('show-moved-v080.json')
const NOT_A_REPOSITORY = JSON.stringify({ code: 'error', error: 'Not a moai repository (no `.moai/` found). Start one with `moai init`, or call a repository elsewhere with `moai -C <dir> <command>`' })

const accepted = (operationId) => ({ action: 'start', operationId, state: 'accepted' })
const passed = (operationId, stdout) => ({ action: 'status', operationId, state: 'passed', stdout, stderr: '', exitCode: 0 })

/**
 * Runs the packed panel in a real DOM, wrapped the way Desktop's panel document wraps it. Each start gets
 * `op-N`; `answer(profileId, value)` gives the finished status for it (or null to keep it running).
 */
async function runPanel(answer, language = 'en') {
  const calls = []
  const runs = new Map()
  let next = 0
  const invokeCommand = async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') {
      const reply = await answer.start?.(args)
      if (reply) return reply
      const id = `op-${++next}`
      runs.set(id, args)
      return accepted(id)
    }
    if (command === 'buzzni.moai.cancel') {
      runs.set(args[0], 'cancelled')
      return { action: 'cancel', operationId: args[0], state: 'cancelled' }
    }
    const run = runs.get(args[0])
    if (run === 'cancelled') return { action: 'status', operationId: args[0], state: 'cancelled', remoteMayContinue: true }
    const finished = answer(run[0], run[1])
    return finished === null ? { action: 'status', operationId: args[0], state: 'running' } : { operationId: args[0], ...finished }
  }
  const dom = new JSDOM(`<!doctype html><html lang="${language}"><head></head><body>${packed.panelHtml}</body></html>`, {
    runScripts: 'dangerously',
    // Arguments cross a MessagePort in Desktop; copying them here also keeps assertions in this realm.
    beforeParse(window) {
      window.saycodePanel = { ready: Promise.resolve(), invokeCommand: (command, args) => invokeCommand(command, structuredClone(args)) }
      const timers = new Set()
      const set = window.setTimeout.bind(window)
      const clear = window.clearTimeout.bind(window)
      let stopped = false
      window.setTimeout = (callback, ms, ...rest) => {
        if (stopped) return 0
        const id = set((...args) => { timers.delete(id); callback(...args) }, ms, ...rest)
        timers.add(id)
        return id
      }
      window.clearTimeout = (id) => { timers.delete(id); clear(id) }
      window.stopTimers = () => { stopped = true; for (const id of timers) clear(id); timers.clear() }
    },
  })
  panelWindows.push(dom.window)
  await flush()
  const $ = (selector) => dom.window.document.querySelector(selector)
  return {
    window: dom.window, calls, $,
    rows: () => [...dom.window.document.querySelectorAll('.moai-list button.moai-row')].map((row) => row.dataset.id),
    row: (id) => [...dom.window.document.querySelectorAll('.moai-list button.moai-row')].find((row) => row.dataset.id === id),
    starts: () => calls.filter(([command]) => command === 'buzzni.moai.run').map(([, args]) => args),
    pressEnter(isComposing) {
      $('.moai-add input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing, bubbles: true, cancelable: true }))
    },
  }
}

const stdoutFor = (outputs) => (profile, value) => {
  const out = outputs[profile]
  if (out === undefined) return null
  const text = typeof out === 'function' ? out(value) : out
  return text === null ? null : (typeof text === 'string' ? passed('', text) : text)
}

test('a project tool opens the Moai board panel in the work area instead of a machine settings button', async () => {
  const parsed = parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
  const open = parsed.contributes.commands.find((command) => command.id === 'buzzni.moai.open')
  assert.equal(open?.panelId, 'buzzni.moai.panel')
  // The host owns the panel title; compact asks for the small modal preset where a host still opens a modal.
  // The panel is built from panel/ into one file (build.mjs).
  assert.deepEqual(parsed.contributes.panels, [{ id: 'buzzni.moai.panel', title: 'Moai', entrypoint: 'dist/panel.html', surfaceSize: 'compact' }])
  assert.deepEqual(parsed.contributes.projectTools, [{ id: 'buzzni.moai.board', title: 'Moai', command: 'buzzni.moai.open' }])
  assert.equal(parsed.contributes.machineActions, undefined)
  // Project tools need a Desktop with engine 1.2.0; an older one refuses the manifest instead of misreading it.
  assert.equal(parsed.engines.saycode, '^1.2.0')
  assert.ok(parsed.activationEvents.includes('onCommand:buzzni.moai.open'))
  const host = createTestHost('buzzni.moai', { async invokeCapability() { throw new Error('not expected') } })
  await host.activate(extension)
  assert.equal(await host.invokeCommand('buzzni.moai.open', []), null)
})

test('the packed panel is one file: inline script and style only, under the 512 KiB panel limit', () => {
  assert.ok(packed.files.includes('dist/panel.html'))
  assert.ok(!packed.files.includes('panel.html'))
  assert.ok(Buffer.byteLength(packed.panelHtml) <= 512 * 1024)
  assert.doesNotMatch(packed.panelHtml, /<script[^>]+src=|<link[^>]+stylesheet|<!-- moai-(style|script) -->/i)
  assert.equal(packed.panelHtml.match(/<script>/g).length, 1)
  // Rows and titles are user text: the panel writes them with textContent, never as markup.
  assert.doesNotMatch(packed.panelHtml, /innerHTML|insertAdjacentHTML|outerHTML|electron|ipcRenderer/)
  // The sandboxed panel cannot submit forms; the host draws the title; init stays a user action, never a chat request.
  assert.doesNotMatch(packed.panelHtml, /<form|'submit'|<h1/)
  assert.doesNotMatch(packed.panelHtml, /\bAI\b|chat|채팅|チャット|聊天/i)
})

test('opening the board reads the list once, draws it by priority and shows when it was read', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME }))
  assert.deepEqual(panel.starts(), [['buzzni.moai.prime']])
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.match(panel.$('.moai-refresh').textContent, /^↻ \d{2}:\d{2}:\d{2}$/)
  assert.match(panel.$('.moai-refresh').title, /^Updated \d{2}:\d{2}:\d{2}$/)
  assert.equal(panel.$('.moai-error').textContent, '')
  for (const [command] of panel.calls) assert.match(command, /^buzzni\.moai\.(run|status|cancel)$/)
})

test('the board follows the host document language', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME }), 'ja')
  assert.equal(panel.$('.moai-add-button').textContent, 'タスクを追加')
  assert.equal(panel.$('.moai-add input').placeholder, '新しいタスクのタイトル')
})

test('choosing a task shows its details beside the list, with history and status moves', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME, 'buzzni.moai.show': (id) => (id === 'mgd-hmcr' ? SHOW_NOTE_BODY : SHOW_MOVED) }), 'ko')
  panel.row('mgd-hmcr').click()
  await flush()
  assert.deepEqual(panel.starts().at(-1), ['buzzni.moai.show', 'mgd-hmcr'])
  assert.equal(panel.row('mgd-hmcr').getAttribute('aria-selected'), 'true')
  // The list stays: the detail no longer replaces it.
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  const detail = panel.$('.moai-detail')
  assert.equal(detail.hidden, false)
  assert.equal(detail.querySelector('h2').textContent, '가이드 첫 할 일')
  const meta = Object.fromEntries([...detail.querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent]))
  assert.equal(meta['상태'], '할 일')
  assert.equal(meta['우선순위'], 'P2')
  assert.equal(meta['ID'], 'mgd-hmcr')
  assert.equal(detail.querySelector('.moai-body').textContent, '본문 첫 줄\n둘째 줄')
  assert.deepEqual([...detail.querySelectorAll('.moai-journal-text')].map((entry) => entry.textContent), ['만들었습니다', '메모 하나'])

  panel.row('mgd-ogym').click()
  await flush()
  assert.deepEqual([...panel.$('.moai-detail').querySelectorAll('.moai-journal-text')].map((entry) => entry.textContent), ['만들었습니다', '할 일 → 진행 중'])
  panel.$('.moai-close').click()
  assert.equal(panel.$('.moai-detail').hidden, true)
})

test('a refused read is explained where it happened; user choices are information, machine problems errors', async () => {
  for (const [code, info] of [['declined', true], ['workspace-busy', true], ['tool-missing', false], ['unsupported-daemon', false]]) {
    const answer = stdoutFor({})
    answer.start = () => ({ action: 'start', state: 'refused', code })
    const panel = await runPanel(answer, 'ko')
    const notice = panel.$('.moai-notice').textContent
    const error = panel.$('.moai-error').textContent
    assert.ok(info ? notice && !error : error && !notice, code)
  }
  const answer = stdoutFor({})
  answer.start = () => { throw new Error('capability.invoke machine.run/start failed: binding-mismatch') }
  const panel = await runPanel(answer)
  assert.equal(panel.$('.moai-error').textContent, 'The run did not start. It may have been declined, or this machine does not support Moai yet.')
  assert.equal(panel.$('.moai-refresh').disabled, false)
})

test('a project without a Moai board says how to start one, from prime or from a failed run', async () => {
  for (const reply of [PRIME_NO_TRACKER, { state: 'failed', stdout: '', stderr: NOT_A_REPOSITORY, exitCode: 1 }]) {
    const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': reply }))
    const notice = panel.$('.moai-notice')
    assert.equal(notice.querySelector('code')?.textContent, 'moai init')
    assert.match(notice.textContent, /^This project has no Moai board yet\./)
    assert.equal(panel.$('.moai-error').textContent, '')
  }
})

test('a failed run shows the reason Moai printed on stderr', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': { state: 'failed', stdout: '', stderr: JSON.stringify({ error: 'config.toml: bad column' }), exitCode: 1 } }))
  assert.equal(panel.$('.moai-error').textContent, 'Moai reported an error: config.toml: bad column')
})

test('adding needs a title, takes Enter but not while an IME composes, and refreshes the list', async () => {
  let listed = PRIME
  const panel = await runPanel(stdoutFor({
    'buzzni.moai.prime': () => listed,
    'buzzni.moai.add': (title) => {
      listed = JSON.stringify({ ...JSON.parse(PRIME), ready: [...JSON.parse(PRIME).ready, { id: 'mgd-new1', title, status: 'todo', priority: 1 }] })
      return JSON.stringify({ id: 'mgd-new1', title, status: 'todo' })
    },
  }), 'ko')
  panel.$('.moai-add-button').click()
  await flush()
  assert.equal(panel.$('.moai-result').textContent, '할 일 제목을 입력하세요.')
  panel.$('.moai-add input').value = '  새 일  '
  panel.pressEnter(true)
  await flush()
  assert.equal(panel.starts().length, 1)
  panel.pressEnter(false)
  await flush()
  assert.deepEqual(panel.starts().slice(1), [['buzzni.moai.add', '새 일'], ['buzzni.moai.prime']])
  assert.equal(panel.$('.moai-result').textContent, '추가했습니다: 새 일 (mgd-new1)')
  assert.equal(panel.$('.moai-add input').value, '')
  assert.deepEqual(panel.rows(), ['mgd-new1', 'mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('until a run is accepted the panel says it may wait for the confirmation; cancel shows only once it runs', async () => {
  let accept
  const answer = (profile) => (profile === 'buzzni.moai.prime' ? null : null)
  answer.start = () => new Promise((resolve) => { accept = () => resolve(null) })
  const panel = await runPanel(answer)
  assert.equal(panel.$('.moai-activity').textContent, 'Starting… approve the confirmation if it is showing.')
  assert.equal(panel.$('.moai-cancel').hidden, true)
  accept()
  await flush()
  assert.equal(panel.$('.moai-activity').textContent, 'Running on the machine…')
  assert.equal(panel.$('.moai-cancel').hidden, false)
  panel.$('.moai-cancel').click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.deepEqual(panel.calls.find(([command]) => command === 'buzzni.moai.cancel'), ['buzzni.moai.cancel', ['op-1']])
  assert.equal(panel.$('.moai-notice').textContent, 'The run was cancelled. Processes on the machine may not have finished yet.')
  assert.equal(panel.$('.moai-cancel').hidden, true)
  assert.equal(panel.$('.moai-activity').textContent, '')
})

test('Refresh reads the list again and keeps the cursor on the same task', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME, 'buzzni.moai.show': SHOW_MOVED }))
  panel.row('mgd-ogym').click()
  await flush()
  panel.$('.moai-refresh').click()
  await flush()
  assert.deepEqual(panel.starts().map(([profile]) => profile), ['buzzni.moai.prime', 'buzzni.moai.show', 'buzzni.moai.prime'])
  assert.equal(panel.row('mgd-ogym').getAttribute('aria-selected'), 'true')
})

test('a truncated list says how many more tasks there are', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': JSON.stringify({ ...JSON.parse(PRIME), rest: 3, others_rest: 2 }) }))
  assert.equal(panel.$('.moai-more').textContent, '5 more not shown')
})

test('an empty banner takes no room, and the page scrolls to rows and details below the fold', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME }))
  for (const selector of ['.moai-notice', '.moai-error', '.moai-result']) {
    assert.equal(panel.window.getComputedStyle(panel.$(selector)).display, 'none', selector)
  }
  // tokens.css stops the body scrolling for the shell's own panes; this one-column view needs the page to scroll.
  assert.equal(panel.window.getComputedStyle(panel.window.document.body).overflow, 'auto')
})

test('why an add did nothing stays on its own line while the list and the detail redraw', async () => {
  const answer = stdoutFor({ 'buzzni.moai.prime': PRIME, 'buzzni.moai.show': SHOW_NOTE_BODY })
  answer.start = (args) => (args[0] === 'buzzni.moai.add' ? { action: 'start', state: 'refused', code: 'declined' } : null)
  const panel = await runPanel(answer)
  panel.$('.moai-add input').value = 'Ship it'
  panel.$('.moai-add-button').click()
  await flush()
  const declined = 'The run did not start: the confirmation was declined.'
  assert.equal(panel.$('.moai-result').textContent, declined)
  panel.row('mgd-hmcr').click()
  await flush()
  panel.$('.moai-refresh').click()
  await flush()
  assert.equal(panel.$('.moai-result').textContent, declined)
  assert.equal(panel.$('.moai-add input').value, 'Ship it')
})

test('a title typed while an add runs stays in the field', async () => {
  let finishing = false
  const panel = await runPanel(stdoutFor({
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.add': (title) => (finishing ? JSON.stringify({ id: 'mgd-new1', title, status: 'todo' }) : null),
  }))
  panel.$('.moai-add input').value = 'First'
  panel.pressEnter(false)
  await flush()
  panel.$('.moai-add input').value = 'Second'
  finishing = true
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-result').textContent, 'Added: First (mgd-new1)')
  assert.equal(panel.$('.moai-add input').value, 'Second')
})

test('a detail asked for a task the next read no longer lists closes instead of staying on Loading', async () => {
  const prime = JSON.parse(PRIME)
  let listed = PRIME
  let holding = false
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': () => (holding ? null : listed), 'buzzni.moai.show': SHOW_MOVED }))
  // A read runs, and a task is chosen meanwhile: its detail waits behind that read.
  holding = true
  panel.$('.moai-refresh').click()
  await flush()
  panel.row('mgd-ogym').click()
  await flush()
  assert.equal(panel.$('.moai-detail').textContent, 'Loading…')
  // The read no longer lists the task, so the cursor moves to its neighbour before the detail answers.
  listed = JSON.stringify({ ...prime, picked: prime.picked.filter((row) => row.id !== 'mgd-ogym') })
  holding = false
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr'])
  assert.equal(panel.row('mgd-hmcr').getAttribute('aria-selected'), 'true')
  assert.equal(panel.$('.moai-detail').hidden, true)
})

test('the row with the keyboard focus keeps it when the list redraws', async () => {
  const panel = await runPanel(stdoutFor({ 'buzzni.moai.prime': PRIME, 'buzzni.moai.show': SHOW_NOTE_BODY }))
  panel.row('mgd-hmcr').focus()
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-detail').hidden, false)
  assert.equal(panel.window.document.activeElement, panel.row('mgd-hmcr'))
})
