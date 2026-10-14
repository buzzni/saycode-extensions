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
// Real Moai v0.16 output: `show --all`, `backlog show --all`, `status`, the archive and the wiki.
const SHOW_ALL_V016 = await fixture('show-all-v016.json')
const BACKLOG_V016 = await fixture('backlog-v016.json')
const STATUS_V016 = await fixture('status-v016.json')
const ARCHIVED_V016 = await fixture('show-archived-v016.json')
const WIKI_LS_V016 = await fixture('wiki-ls-v016.json')
const WIKI_SHOW_V016 = await fixture('wiki-show-v016.json')
const READ_ONE_V016 = await fixture('read-one-v016.json')
const READ_ALL_V016 = await fixture('read-all-v016.json')
const READ_GROUP_V016 = await fixture('read-group-v016.json')
// The v0.8.0 tracker the detail fixtures come from, as `show --all` lists it (prime's rows: nothing else is in it),
// and `status` for it. The board reads `show --all`, `backlog show --all` and `status` side by side.
const listOf = (prime) => {
  const parsed = JSON.parse(prime)
  return JSON.stringify([...parsed.picked, ...parsed.others, ...parsed.ready].map((row) => ({ kind: 'issue', ...row })))
}
const SHOW_ALL = listOf(PRIME)
const NO_BACKLOG = '[]'
const STATUS = JSON.stringify({ counts: { done: 0, in_progress: 1, review: 1, todo: 1 }, total: 3, milestones: [], epics: [] })
const NOT_A_REPOSITORY = JSON.stringify({ code: 'error', error: 'Not a moai repository (no `.moai/` found). Start one with `moai init`, or call a repository elsewhere with `moai -C <dir> <command>`' })

const accepted = (operationId) => ({ action: 'start', operationId, state: 'accepted' })
const passed = (operationId, stdout) => ({ action: 'status', operationId, state: 'passed', stdout, stderr: '', exitCode: 0 })

/**
 * Runs the packed panel in a real DOM, wrapped the way Desktop's panel document wraps it. Each start gets
 * `op-N` (told to `answer.started(op, args)` when given); `answer(profileId, value, op)` gives the finished status for
 * it (or null to keep it running).
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
      answer.started?.(id, args)
      return accepted(id)
    }
    if (command === 'buzzni.moai.cancel') {
      runs.set(args[0], 'cancelled')
      return { action: 'cancel', operationId: args[0], state: 'cancelled' }
    }
    const run = runs.get(args[0])
    if (run === 'cancelled') return { action: 'status', operationId: args[0], state: 'cancelled', remoteMayContinue: true }
    const finished = answer(run[0], run[1], args[0])
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
    rows: () => [...dom.window.document.querySelectorAll('.moai-list .moai-line[data-id]')].map((row) => row.dataset.id),
    row: (id) => [...dom.window.document.querySelectorAll('.moai-list .moai-line[data-id]')].find((row) => row.dataset.id === id),
    starts: () => calls.filter(([command]) => command === 'buzzni.moai.run').map(([, args]) => args),
    pressEnter(isComposing) {
      $('.moai-add input').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing, bubbles: true, cancelable: true }))
    },
  }
}

const stdoutFor = (outputs) => (profile, value, op) => {
  const out = outputs[profile]
  if (out === undefined) return null
  const text = typeof out === 'function' ? out(value, op) : out
  return text === null ? null : (typeof text === 'string' ? passed('', text) : text)
}
/** The board's three reads answered (the v0.8.0 tracker unless given), with `outputs` for the rest. */
const board = (outputs = {}) => stdoutFor({ 'buzzni.moai.show-all': SHOW_ALL, 'buzzni.moai.backlog-all': NO_BACKLOG, 'buzzni.moai.status': STATUS, ...outputs })
const LIST_READS = [['buzzni.moai.show-all'], ['buzzni.moai.backlog-all'], ['buzzni.moai.status']]
/** `show --all` cut by the daemon at the output limit: the flag on a finished status whose stdout no longer parses. */
const cut = { state: 'passed', stdout: '[{"id":"mgd-', stderr: '', exitCode: 0, truncated: true }

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
  const panel = await runPanel(board())
  assert.deepEqual(panel.starts(), LIST_READS)
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.match(panel.$('.moai-refresh').textContent, /^↻ \d{2}:\d{2}:\d{2}$/)
  assert.match(panel.$('.moai-refresh').title, /^Updated \d{2}:\d{2}:\d{2}$/)
  assert.equal(panel.$('.moai-error').textContent, '')
  for (const [command] of panel.calls) assert.match(command, /^buzzni\.moai\.(run|status|cancel)$/)
})

test('the board follows the host document language', async () => {
  const panel = await runPanel(board(), 'ja')
  assert.equal(panel.$('.moai-add-button').textContent, 'タスクを追加')
  assert.equal(panel.$('.moai-add input').placeholder, '新しいタスクのタイトル')
})

test('choosing a task shows its details beside the list, with history and status moves', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show': (id) => (id === 'mgd-hmcr' ? SHOW_NOTE_BODY : SHOW_MOVED) }), 'ko')
  panel.row('mgd-hmcr').click()
  await flush()
  assert.deepEqual(panel.starts().at(-1), ['buzzni.moai.show', 'mgd-hmcr'])
  assert.equal(panel.row('mgd-hmcr').getAttribute('aria-selected'), 'true')
  // The list stays: the detail no longer replaces it.
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  const detail = panel.$('.moai-detail')
  assert.equal(panel.$('.m-split').dataset.detail, 'shown')
  assert.equal(detail.querySelector('h2').textContent, '가이드 첫 할 일')
  // Id, status and priority are the head line's text and chips, not labeled fields.
  assert.equal(detail.querySelector('.moai-detail-id').textContent, 'mgd-hmcr')
  assert.deepEqual([...detail.querySelectorAll('.moai-detail-chips > *')].map((chip) => chip.textContent).slice(0, 2), ['할 일', 'P2'])
  assert.equal(detail.querySelector('.moai-detail-body').textContent, '본문 첫 줄\n둘째 줄')
  assert.deepEqual([...detail.querySelectorAll('details[data-fold="journal"] li > span:first-child')].map((entry) => entry.textContent), ['만들었습니다', '메모 하나'])

  panel.row('mgd-ogym').click()
  await flush()
  assert.deepEqual([...panel.$('.moai-detail').querySelectorAll('details[data-fold="journal"] li > span:first-child')].map((entry) => entry.textContent), ['만들었습니다', '할 일 → 진행 중'])
  panel.$('.moai-detail [data-focus="close"]').click()
  await flush()
  // Closing clears what the detail shows (it says to choose a task); the cursor row stays where it was.
  assert.equal(panel.$('.moai-detail h2'), null)
  assert.equal(panel.$('.moai-detail .m-empty-title').textContent, '할 일을 고르면 상세가 여기에 나옵니다.')
})

test('a refused read is explained where it happened; user choices are information, machine problems errors', async () => {
  // workspace-busy is tried again before it is told (the next test); tool-missing is the compatibility banner's to
  // tell. unsupported-daemon on every profile is the daemon as a whole, which that banner does not name.
  for (const [code, info] of [['declined', true], ['unsupported-platform', false], ['unsupported-daemon', false]]) {
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

test('a read refused as workspace-busy is tried again, and told only when the last try is refused too', async () => {
  // Busy once: the second try a second later goes through, and nothing was said meanwhile.
  let busy = 1
  const once = board()
  once.start = (args) => (args[0] === 'buzzni.moai.show-all' && busy-- > 0 ? { action: 'start', state: 'refused', code: 'workspace-busy' } : null)
  const passing = await runPanel(once)
  assert.deepEqual(passing.rows(), [])
  assert.equal(passing.$('.moai-notice').textContent, '')
  await new Promise((resolve) => setTimeout(resolve, 1700))
  await flush()
  assert.deepEqual(passing.starts().filter(([profile]) => profile === 'buzzni.moai.show-all').length, 2)
  assert.deepEqual(passing.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.equal(passing.$('.moai-notice').textContent, '')
  // Busy every time: three tries, 1 s and then 2 s apart, and then the notice (information, not an error).
  const always = board()
  always.start = () => ({ action: 'start', state: 'refused', code: 'workspace-busy' })
  const panel = await runPanel(always, 'ko')
  assert.equal(panel.$('.moai-notice').textContent, '')
  await new Promise((resolve) => setTimeout(resolve, 3300))
  await flush()
  assert.equal(panel.starts().filter(([profile]) => profile === 'buzzni.moai.show-all').length, 3)
  assert.ok(panel.$('.moai-notice').textContent)
  assert.equal(panel.$('.moai-error').textContent, '')
})

test('a project without a Moai board says how to start one, from a failed run or from prime after a cut list', async () => {
  for (const reply of [{ state: 'failed', stdout: '', stderr: NOT_A_REPOSITORY, exitCode: 1 }, cut]) {
    const panel = await runPanel(board({ 'buzzni.moai.show-all': reply, 'buzzni.moai.prime': PRIME_NO_TRACKER }))
    const notice = panel.$('.moai-notice')
    assert.equal(notice.querySelector('code')?.textContent, 'moai init')
    assert.match(notice.textContent, /^This project has no Moai board yet\./)
    assert.equal(panel.$('.moai-error').textContent, '')
  }
})

test('a failed run shows the reason Moai printed on stderr', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show-all': { state: 'failed', stdout: '', stderr: JSON.stringify({ error: 'config.toml: bad column' }), exitCode: 1 } }))
  assert.equal(panel.$('.moai-error').textContent, 'Moai reported an error: config.toml: bad column')
})

test('adding needs a title, takes Enter but not while an IME composes, and refreshes the list', async () => {
  let listed = SHOW_ALL
  const panel = await runPanel(board({
    'buzzni.moai.show-all': () => listed,
    'buzzni.moai.add': (title) => {
      listed = JSON.stringify([...JSON.parse(SHOW_ALL), { id: 'mgd-new1', title, status: 'todo', priority: 1, kind: 'issue' }])
      return JSON.stringify({ id: 'mgd-new1', title, status: 'todo' })
    },
  }), 'ko')
  panel.$('.moai-add-button').click()
  await flush()
  assert.equal(panel.$('.moai-result').textContent, '할 일 제목을 입력하세요.')
  panel.$('.moai-add input').value = '  새 일  '
  panel.pressEnter(true)
  await flush()
  assert.equal(panel.starts().length, 3)
  panel.pressEnter(false)
  await flush()
  assert.deepEqual(panel.starts().slice(3), [['buzzni.moai.add', '새 일'], ...LIST_READS])
  assert.equal(panel.$('.moai-result').textContent, '추가했습니다: 새 일 (mgd-new1)')
  assert.equal(panel.$('.moai-add input').value, '')
  assert.deepEqual(panel.rows(), ['mgd-new1', 'mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('until a run is accepted the panel says it may wait for the confirmation; cancel shows only once it runs', async () => {
  // The list's three reads start at once (3 at a time); each waits for its confirmation.
  const accepts = []
  const answer = () => null
  answer.start = () => new Promise((resolve) => accepts.push(() => resolve(null)))
  const panel = await runPanel(answer)
  assert.equal(accepts.length, 3)
  assert.equal(panel.$('.moai-activity').textContent, 'Starting… approve the confirmation if it is showing.')
  assert.equal(panel.$('.moai-cancel').hidden, true)
  for (const accept of accepts) accept()
  await flush()
  assert.equal(panel.$('.moai-activity').textContent, 'Running on the machine…')
  assert.equal(panel.$('.moai-cancel').hidden, false)
  panel.$('.moai-cancel').click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  // Cancel stops every run of the list, not only the first.
  assert.deepEqual(panel.calls.find(([command]) => command === 'buzzni.moai.cancel'), ['buzzni.moai.cancel', ['op-1']])
  assert.deepEqual([...new Set(panel.calls.filter(([command]) => command === 'buzzni.moai.cancel').map(([, [id]]) => id))].sort(), ['op-1', 'op-2', 'op-3'])
  assert.equal(panel.$('.moai-notice').textContent, 'The run was cancelled. Processes on the machine may not have finished yet.')
  assert.equal(panel.$('.moai-cancel').hidden, true)
  assert.equal(panel.$('.moai-activity').textContent, '')
})

test('Refresh reads the list again and keeps the cursor on the same task', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show': SHOW_MOVED }))
  panel.row('mgd-ogym').click()
  await flush()
  panel.$('.moai-refresh').click()
  await flush()
  assert.deepEqual(panel.starts(), [...LIST_READS, ['buzzni.moai.show', 'mgd-ogym'], ...LIST_READS])
  assert.equal(panel.row('mgd-ogym').getAttribute('aria-selected'), 'true')
})

test('a list cut at the output limit stands on prime, says so in a banner and how many more tasks there are', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show-all': cut, 'buzzni.moai.prime': JSON.stringify({ ...JSON.parse(PRIME), rest: 3, others_rest: 2 }) }))
  assert.deepEqual(panel.starts().map(([profile]) => profile), ['buzzni.moai.show-all', 'buzzni.moai.backlog-all', 'buzzni.moai.status', 'buzzni.moai.prime'])
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.equal(panel.$('.moai-truncated').textContent, 'The whole list was too large to read, so only the tasks held and ready to pick up (and the backlog) are shown.')
  assert.notEqual(panel.window.getComputedStyle(panel.$('.moai-truncated')).display, 'none')
  assert.equal(panel.$('.moai-more').textContent, '5 more not shown')
  // The whole list read again: the banner goes.
  const whole = await runPanel(board(), 'ko')
  assert.equal(whole.$('.moai-truncated').textContent, '')
})

test('an empty banner takes no room, and the panes scroll to rows and details below the fold', async () => {
  const panel = await runPanel(board())
  for (const selector of ['.moai-notice', '.moai-error', '.moai-truncated', '.moai-result', '.moai-more']) {
    assert.equal(panel.window.getComputedStyle(panel.$(selector)).display, 'none', selector)
  }
  // The page itself does not scroll (tokens.css); the list and the detail scroll in their own panes.
  const style = (selector) => panel.window.getComputedStyle(panel.$(selector))
  assert.equal(style('body').overflow, 'hidden')
  assert.equal(style('.m-pane-main[data-pane="list"]').overflow, 'auto')
  assert.equal(style('.m-split-detail').overflow, 'auto')
})

test('why an add did nothing stays on its own line while the list and the detail redraw', async () => {
  const answer = board({ 'buzzni.moai.show': SHOW_NOTE_BODY })
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
  const panel = await runPanel(board({
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
  let listed = SHOW_ALL
  let holding = false
  const panel = await runPanel(board({ 'buzzni.moai.show-all': () => (holding ? null : listed), 'buzzni.moai.show': () => (holding ? null : SHOW_MOVED) }))
  // A read runs, and a task is chosen meanwhile: its detail runs beside that read (3 at once), and both are slow.
  holding = true
  panel.$('.moai-refresh').click()
  await flush()
  panel.row('mgd-ogym').click()
  await flush()
  assert.deepEqual(panel.starts().at(-1), ['buzzni.moai.show', 'mgd-ogym'])
  assert.equal(panel.$('.moai-detail').textContent, 'Loading…')
  // The read no longer lists the task, so the cursor moves to its neighbour; the detail answers after it.
  listed = JSON.stringify(JSON.parse(SHOW_ALL).filter((row) => row.id !== 'mgd-ogym'))
  holding = false
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr'])
  assert.equal(panel.row('mgd-hmcr').getAttribute('aria-selected'), 'true')
  // The pane says to choose a task. (`h2 === null` alone would also hold while it is stuck on "Loading…".)
  assert.equal(panel.$('.moai-detail .m-empty-title').textContent, 'Choose a task to see its details.')
  assert.doesNotMatch(panel.$('.moai-detail').textContent, /Loading/)
})

test('a loaded detail goes when a reload no longer lists its task', async () => {
  let listed = SHOW_ALL
  const panel = await runPanel(board({ 'buzzni.moai.show-all': () => listed, 'buzzni.moai.show': SHOW_MOVED }))
  panel.row('mgd-ogym').click()
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '버튼으로 추가한 할 일')
  // The task is finished elsewhere: the next read does not list it. Its detail does not stay beside another row.
  listed = JSON.stringify(JSON.parse(SHOW_ALL).filter((row) => row.id !== 'mgd-ogym'))
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.row('mgd-ogym'), undefined)
  assert.equal(panel.$('.moai-detail h2'), null)
  assert.equal(panel.$('.moai-detail .m-empty-title').textContent, 'Choose a task to see its details.')
})

test('a key press that moves the cursor while a detail is read does not discard the answer', async () => {
  let holding = true
  const panel = await runPanel(board({ 'buzzni.moai.show': () => (holding ? null : SHOW_NOTE_BODY) }))
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-detail').textContent, 'Loading…')
  // ArrowDown moves the cursor without reading a detail (list.ts `point`).
  panel.$('.moai-list').dispatchEvent(new panel.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
  assert.equal(panel.row('mgd-ogym').getAttribute('aria-selected'), 'true')
  holding = false
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일', 'the task that was chosen is shown')
  assert.equal(panel.row('mgd-ogym').getAttribute('aria-selected'), 'true', 'the cursor stays where the key left it')
})

test('closing the detail while its read is still running keeps it closed', async () => {
  let holding = false
  const panel = await runPanel(board({ 'buzzni.moai.show': () => (holding ? null : SHOW_NOTE_BODY) }))
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일')
  // Choosing the same task again reads it again; the pane keeps showing the old answer meanwhile, with its Close.
  holding = true
  panel.row('mgd-hmcr').click()
  await flush()
  panel.$('.moai-detail [data-focus="close"]').click()
  assert.equal(panel.$('.moai-detail .m-empty-title').textContent, 'Choose a task to see its details.')
  holding = false
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-detail h2'), null, 'the answer to a read nobody waits for does not reopen the pane')
})

test('the row with the keyboard focus keeps it when the list redraws', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show': SHOW_NOTE_BODY }))
  // The keyboard focus lives on the treegrid itself and points at the row (aria-activedescendant), so a redraw keeps it.
  const list = panel.$('.moai-list')
  list.focus()
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일')
  assert.equal(panel.window.document.activeElement, list)
  assert.equal(list.getAttribute('aria-activedescendant'), panel.row('mgd-hmcr').id)
})

/** Keys as the browser sends them, to the element with the focus (the key router listens on the document). */
const press = (panel, ...keys) => {
  for (const key of keys) {
    const target = panel.window.document.activeElement ?? panel.window.document.body
    target.dispatchEvent(new panel.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  }
}
const countsOf = (panel, id) => panel.row(id)?.querySelector('.moai-c-counts')?.textContent

test('the board reads show --all and the backlog, and its milestone and epic counts come from status', async () => {
  const status = JSON.parse(STATUS_V016)
  status.milestones[0] = { ...status.milestones[0], done: 5, total: 9 }
  const panel = await runPanel(board({ 'buzzni.moai.show-all': SHOW_ALL_V016, 'buzzni.moai.backlog-all': BACKLOG_V016, 'buzzni.moai.status': JSON.stringify(status) }))
  assert.deepEqual(panel.starts(), LIST_READS)
  // status counts the archived members too, which show --all leaves out: its 5/9, not the rows' own 1/2.
  assert.equal(countsOf(panel, 'tracker-e0ue'), '5/9')
  // When status cannot be read the board counts its own rows.
  const failing = await runPanel(board({ 'buzzni.moai.show-all': SHOW_ALL_V016, 'buzzni.moai.backlog-all': BACKLOG_V016, 'buzzni.moai.status': { state: 'failed', stdout: '', stderr: '', exitCode: 1 } }))
  assert.equal(countsOf(failing, 'tracker-e0ue'), '1/2')
  assert.equal(failing.$('.moai-error').textContent, '')
})

test('showing archived rows reads the archive and adds the rows only it holds', async () => {
  const old = { id: 'mgd-old1', title: '오래전에 끝낸 일', status: 'done', kind: 'issue', priority: 2, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', status_since: '2026-01-02T00:00:00Z', done_at: '2026-01-02T00:00:00Z' }
  // `--archived` lists the active rows too; only the row the active ones do not hold is archive-only.
  const archived = JSON.stringify([...JSON.parse(SHOW_ALL), old])
  const panel = await runPanel(board({ 'buzzni.moai.show-archived': archived }))
  assert.equal(panel.starts().some(([profile]) => profile === 'buzzni.moai.show-archived'), false)
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.deepEqual(panel.starts().at(-1), ['buzzni.moai.show-archived'])
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym', 'mgd-old1'])
  // Turned off, the archive's rows go again.
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('the wiki tab lists the pages and shows one, and says why when the listing cannot be read', async () => {
  const guide = JSON.stringify({ ...JSON.parse(WIKI_SHOW_V016), slug: 'guide', title: 'Guide', path: 'docs/guide.md', body: '# Guide\n\nBack [[home]].\n' })
  const panel = await runPanel(board({ 'buzzni.moai.wiki-ls': WIKI_LS_V016, 'buzzni.moai.wiki-show': (slug) => (slug === 'home' ? WIKI_SHOW_V016 : slug === 'guide' ? guide : null) }))
  press(panel, ' ', 'g', 'w')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await flush()
  assert.ok(panel.starts().some(([profile]) => profile === 'buzzni.moai.wiki-ls'))
  // The listing opens its first page.
  assert.deepEqual(panel.starts().filter(([profile]) => profile === 'buzzni.moai.wiki-show'), [['buzzni.moai.wiki-show', 'guide']])
  const wiki = panel.$('.m-pane-wiki')
  assert.match(wiki.textContent, /Home/)
  assert.match(wiki.textContent, /Back/)
  assert.doesNotMatch(wiki.textContent, /cannot be read here yet/)

  const answer = board()
  answer.start = (args) => (args[0] === 'buzzni.moai.wiki-ls' ? { action: 'start', state: 'refused', code: 'declined' } : null)
  const refused = await runPanel(answer)
  press(refused, ' ', 'g', 'w')
  await flush()
  assert.match(refused.$('.m-pane-wiki').textContent, /The wiki pages could not be read: The run did not start: the confirmation was declined\./)
})

test('r marks the row under the cursor read, SPC m a everything, and the list is read again after each', async () => {
  let reads = 0
  const panel = await runPanel(board({
    'buzzni.moai.show': SHOW_NOTE_BODY,
    'buzzni.moai.read': () => { reads++; return READ_ONE_V016 },
    'buzzni.moai.read-all': READ_ALL_V016,
    'buzzni.moai.read-group': READ_GROUP_V016,
  }))
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  const before = panel.starts().length
  press(panel, 'r')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.equal(reads, 1)
  // The detail on screen is not read again: `show` printed no `unread` on it, and a mark only takes that off.
  assert.deepEqual(panel.starts().slice(before), [['buzzni.moai.read', 'mgd-hmcr'], ...LIST_READS])
  const after = panel.starts().length
  press(panel, ' ', 'm', 'a')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.deepEqual(panel.starts().slice(after), [['buzzni.moai.read-all'], ...LIST_READS])
  // No milestone or epic here: SPC m g says where to go instead of writing anything.
  const grouped = panel.starts().length
  press(panel, ' ', 'm', 'g')
  await flush()
  assert.equal(panel.starts().length, grouped)
  assert.equal(panel.$('.moai-result').textContent, 'Move to a milestone or epic to mark its items read.')
})

/** `moai read`'s answer for `ids`, as it prints them. */
const readAnswer = (...ids) => JSON.stringify({ read: ids, missing: [], held: [], problems: [], at: '2026-10-14T00:00:00Z' })
/** The tab badge and the NEW chips a panel draws now: the list row's, the detail's. */
const newMarks = (panel, id) => ({
  badge: panel.$('#m-tab-list .m-chip-new')?.textContent ?? null,
  row: panel.row(id)?.querySelector('.m-chip-new')?.textContent ?? null,
  detail: panel.$('.moai-detail-chips .m-chip-new')?.textContent ?? null,
})

test('a read mark takes NEW off the detail on screen as it does off the list row and the tab', async () => {
  let marked = false
  const unread = () => (marked ? {} : { unread: true })
  const panel = await runPanel(board({
    'buzzni.moai.show-all': () => JSON.stringify(JSON.parse(SHOW_ALL).map((row) => (row.id === 'mgd-hmcr' ? { ...row, ...unread() } : row))),
    // `show` prints the row as it is now: unread until the mark is written.
    'buzzni.moai.show': () => JSON.stringify({ ...JSON.parse(SHOW_NOTE_BODY), ...unread() }),
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-hmcr') },
  }))
  panel.row('mgd-hmcr').click()
  await flush()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: '1', row: 'NEW', detail: 'NEW' })
  panel.window.document.body.focus()
  const before = panel.starts().length
  press(panel, 'r')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: null, row: null, detail: null }, 'the detail was read again with the list')
  assert.deepEqual(panel.starts().slice(before), [['buzzni.moai.read', 'mgd-hmcr'], ...LIST_READS, ['buzzni.moai.show', 'mgd-hmcr']])
  // The pane and the cursor stayed on the row.
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일')
  assert.equal(panel.row('mgd-hmcr').getAttribute('aria-selected'), 'true')
})

test('a read mark in a cut list reads the archive answer again: a row only it holds loses NEW with the rest', async () => {
  let marked = false
  let archiveReads = 0
  const only = () => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, ...(marked ? {} : { unread: true }) })
  const panel = await runPanel(board({
    'buzzni.moai.show-all': cut,
    'buzzni.moai.prime': PRIME,
    // `--archived` lists the active rows too; the row that is in progress is active, only the cut list lacks it.
    'buzzni.moai.show-archived': () => { archiveReads++; return JSON.stringify([...JSON.parse(SHOW_ALL), only()]) },
    'buzzni.moai.show': () => JSON.stringify(only()),
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-only') },
  }))
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.equal(archiveReads, 1)
  panel.row('mgd-only').click()
  await flush()
  assert.deepEqual(newMarks(panel, 'mgd-only'), { badge: '1', row: 'NEW', detail: 'NEW' })
  panel.window.document.body.focus()
  press(panel, 'r')
  await new Promise((resolve) => setTimeout(resolve, 900))
  await flush()
  assert.equal(archiveReads, 2, 'the archive answer is read again after the mark')
  assert.ok(panel.row('mgd-only'), 'the row the archive answer holds is still listed')
  assert.equal(panel.$('.moai-detail h2').textContent, 'Only the archive answer holds me')
  assert.deepEqual(newMarks(panel, 'mgd-only'), { badge: null, row: null, detail: null })
})

test('a read mark in a whole list does not read the archive again: what it adds there is never NEW', async () => {
  let archiveReads = 0
  const panel = await runPanel(board({
    'buzzni.moai.show-all': () => JSON.stringify(JSON.parse(SHOW_ALL).map((row) => (row.id === 'mgd-hmcr' ? { ...row, unread: true } : row))),
    'buzzni.moai.show-archived': () => { archiveReads++; return SHOW_ALL },
    'buzzni.moai.read': () => readAnswer('mgd-hmcr'),
  }))
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.equal(archiveReads, 1)
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await new Promise((resolve) => setTimeout(resolve, 900))
  await flush()
  assert.equal(archiveReads, 1)
})

test('the detail read again after a mark gives way: a row chosen meanwhile keeps the pane, and a closed pane stays closed', async () => {
  let held = null
  let release
  const answer = board({
    // Unread as `show` prints them, so a mark reads the detail on screen again.
    'buzzni.moai.show': (id) => JSON.stringify({ ...JSON.parse(id === 'mgd-hmcr' ? SHOW_NOTE_BODY : SHOW_MOVED), unread: true }),
    'buzzni.moai.read': (id) => readAnswer(id),
  })
  // The read again of the row `held` names, after the mark, waits on its confirmation until released.
  answer.start = (args) => (args[0] === 'buzzni.moai.show' && args[1] === held ? new Promise((resolve) => { release = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  const reread = async (id) => {
    held = id
    release = undefined
    panel.window.document.body.focus()
    press(panel, 'r')
    await new Promise((resolve) => setTimeout(resolve, 600))
    await flush()
    assert.equal(typeof release, 'function', `the detail of ${id} is being read again`)
  }
  const settle = async () => {
    release()
    await new Promise((resolve) => setTimeout(resolve, 600))
    await flush()
  }
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일')
  await reread('mgd-hmcr')
  // Another row is chosen meanwhile, and its own read answers first.
  panel.row('mgd-ogym').click()
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.equal(panel.$('.moai-detail h2').textContent, '버튼으로 추가한 할 일')
  await settle()
  assert.equal(panel.$('.moai-detail h2').textContent, '버튼으로 추가한 할 일', 'the row left behind does not take the pane back')
  assert.equal(panel.row('mgd-ogym').getAttribute('aria-selected'), 'true')
  // The pane is closed while its row is read again: the late answer does not open it.
  await reread('mgd-ogym')
  panel.$('.moai-detail [data-focus="close"]').click()
  await flush()
  assert.equal(panel.$('.moai-detail h2'), null)
  await settle()
  assert.equal(panel.$('.moai-detail h2'), null, 'a closed pane stays closed')
})

/**
 * Answers for a tracker whose `mgd-hmcr` is unread until `read`/`read-all` mark it, the way moai prints them: each
 * `show` run answers as the marks stood when it started (moai reads them as it runs), and keeps running while
 * `at.hold(op)` says so. `at.shows` lists the `show` runs started, oldest first.
 */
function markedLater() {
  const at = { marked: false, hold: () => false, shows: [], seen: new Map() }
  const unread = (marked) => (marked ? {} : { unread: true })
  const answer = board({
    'buzzni.moai.show-all': () => JSON.stringify(JSON.parse(SHOW_ALL).map((row) => (row.id === 'mgd-hmcr' ? { ...row, ...unread(at.marked) } : row))),
    'buzzni.moai.show': (id, op) => (at.hold(op) ? null : JSON.stringify({ ...JSON.parse(id === 'mgd-hmcr' ? SHOW_NOTE_BODY : SHOW_MOVED), ...(id === 'mgd-hmcr' ? unread(at.seen.get(op)) : {}) })),
    'buzzni.moai.read': (id) => { at.marked ||= id === 'mgd-hmcr'; return readAnswer(id) },
    'buzzni.moai.read-all': () => { at.marked = true; return readAnswer('mgd-hmcr') },
  })
  answer.started = (op, args) => {
    at.seen.set(op, at.marked)
    if (args[0] === 'buzzni.moai.show') at.shows.push(op)
  }
  return { answer, at }
}
const settled = async (ms = 600) => { await new Promise((resolve) => setTimeout(resolve, ms)); await flush() }

test('a detail read that began before a mark and answers after it is read again: NEW does not come back on the detail', async () => {
  const { answer, at } = markedLater()
  const panel = await runPanel(answer)
  assert.equal(newMarks(panel, 'mgd-hmcr').row, 'NEW')
  // The row is chosen and `r` pressed before its `show` answers: that run read the marks before the write.
  at.hold = () => true
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(at.marked, true)
  at.hold = () => false
  await settled()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: null, row: null, detail: null })
  assert.equal(panel.$('.moai-detail h2').textContent, '가이드 첫 할 일')
  assert.equal(at.shows.length, 2, 'read again once, after the mark')
})

test('a row clicked again after a mark, while its read from before the mark still runs, is read afresh', async () => {
  const { answer, at } = markedLater()
  const panel = await runPanel(answer)
  at.hold = () => true
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(at.marked, true)
  // Clicked again after the mark: the run that began before it is still going, and is not the one that answers.
  panel.row('mgd-hmcr').click()
  await flush()
  at.hold = () => false
  await settled()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: null, row: null, detail: null })
  assert.equal(at.shows.length, 2)
})

test('the row on screen chosen again just before a mark: its read again is not handed the run that began before the mark', async () => {
  const { answer, at } = markedLater()
  const panel = await runPanel(answer)
  panel.row('mgd-hmcr').click()
  await settled()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: '1', row: 'NEW', detail: 'NEW' })
  at.hold = () => true
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  at.hold = () => false
  await settled()
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: null, row: null, detail: null })
  assert.equal(at.shows.length, 3)
})

test('the detail on screen is read again only after a mark that wrote it, as `moai read` answers', async () => {
  const { answer, at } = markedLater()
  const panel = await runPanel(answer)
  panel.row('mgd-hmcr').click()
  await settled()
  assert.equal(newMarks(panel, 'mgd-hmcr').detail, 'NEW')
  // `r` on another row: the detail on screen, still unread, is not what was written.
  panel.window.document.body.focus()
  press(panel, 'j', 'r')
  await settled(900)
  assert.equal(at.shows.length, 1)
  assert.equal(newMarks(panel, 'mgd-hmcr').detail, 'NEW')
  // SPC m a writes it: read again, afresh.
  press(panel, ' ', 'm', 'a')
  await settled(900)
  assert.equal(at.shows.length, 2)
  assert.deepEqual(newMarks(panel, 'mgd-hmcr'), { badge: null, row: null, detail: null })
})

test('the archive is read again after a mark though the detail read again still waits on its confirmation', async () => {
  let marked = false
  let archiveReads = 0
  let release
  const only = () => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, ...(marked ? {} : { unread: true }) })
  const answer = board({
    'buzzni.moai.show-all': cut,
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => { archiveReads++; return JSON.stringify([...JSON.parse(SHOW_ALL), only()]) },
    'buzzni.moai.show': () => JSON.stringify(only()),
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-only') },
  })
  // The detail's read again after the mark waits on its confirmation until released.
  answer.start = (args) => (args[0] === 'buzzni.moai.show' && marked ? new Promise((resolve) => { release = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  panel.row('mgd-only').click()
  await settled()
  assert.equal(newMarks(panel, 'mgd-only').detail, 'NEW')
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(typeof release, 'function', 'the detail read again waits')
  assert.equal(archiveReads, 2, 'the archive is read again all the same')
  assert.deepEqual([newMarks(panel, 'mgd-only').badge, newMarks(panel, 'mgd-only').row], [null, null])
  release()
  await settled()
  assert.equal(newMarks(panel, 'mgd-only').detail, null)
})

test('an archive read still running when a mark lands is read again once it ends, not handed to the read after the mark', async () => {
  let marked = false
  let hold = false
  let started = false
  let archiveReads = 0
  const only = (unread) => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, ...(unread ? { unread: true } : {}) })
  const answer = board({
    'buzzni.moai.show-all': cut,
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => (hold ? null : JSON.stringify([...JSON.parse(SHOW_ALL), only(!started)])),
    'buzzni.moai.read-all': () => { marked = true; return readAnswer('mgd-only') },
  })
  answer.start = (args) => { if (args[0] === 'buzzni.moai.show-archived') { archiveReads++; started = marked } return null }
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  assert.equal(newMarks(panel, 'mgd-only').row, 'NEW')
  // Archived rows turned off and on: a new archive read starts before the mark and is held running.
  hold = true
  press(panel, ' ', 'v', 'o', 'Escape')
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  panel.window.document.body.focus()
  press(panel, ' ', 'm', 'a')
  await settled(900)
  assert.equal(marked, true)
  assert.equal(archiveReads, 2, 'not started over at the mark')
  hold = false
  await settled(900)
  assert.equal(archiveReads, 3, 'read again once the read asked before the mark ended')
  assert.deepEqual(newMarks(panel, 'mgd-only'), { badge: null, row: null, detail: null })
})

test('a list prime stands in for because the catalog lacks show --all reads the archive answer again after a mark too', async () => {
  let marked = false
  let archiveReads = 0
  const only = () => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, ...(marked ? {} : { unread: true }) })
  const answer = board({
    'buzzni.moai.status': STATUS_V017,
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => { archiveReads++; return JSON.stringify([...JSON.parse(SHOW_ALL), only()]) },
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-only') },
  })
  answer.start = (args) => (args[0] === 'buzzni.moai.show-all' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  assert.equal(newMarks(panel, 'mgd-only').row, 'NEW')
  panel.row('mgd-only').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(archiveReads, 2)
  assert.deepEqual([newMarks(panel, 'mgd-only').badge, newMarks(panel, 'mgd-only').row], [null, null])
})

test('a mark in a cut list reads the archive again only while archived rows show and a row only it holds is NEW', async () => {
  let archiveReads = 0
  let unread = true
  const only = () => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, ...(unread ? { unread: true } : {}) })
  const panel = await runPanel(board({
    'buzzni.moai.show-all': cut,
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => { archiveReads++; return JSON.stringify([...JSON.parse(SHOW_ALL), only()]) },
    'buzzni.moai.show': SHOW_NOTE_BODY,
    'buzzni.moai.read': (id) => readAnswer(id),
  }))
  const writes = () => panel.starts().filter(([profile]) => profile === 'buzzni.moai.read').length
  panel.row('mgd-hmcr').click()
  await flush()
  // Archived rows hidden: the archive is not the list's, and nothing reads it.
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(writes(), 1)
  assert.equal(archiveReads, 0)
  // Shown, with nothing the archive alone holds drawn NEW: a mark can take nothing off there.
  unread = false
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  assert.equal(archiveReads, 1)
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(writes(), 2)
  assert.equal(archiveReads, 1)
  // A row only the archive holds is NEW, but the write did not mark it (`moai read` answers the ids it wrote).
  unread = true
  press(panel, ' ', 'v', 'o', 'Escape', ' ', 'v', 'o', 'Escape')
  await settled()
  assert.equal(archiveReads, 2)
  assert.equal(newMarks(panel, 'mgd-only').row, 'NEW')
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(writes(), 3)
  assert.equal(archiveReads, 2)
})

test('an archive read the person cancels after a mark is not started again on its own', async () => {
  let hold = false
  let archiveStarts = 0
  const only = { id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'in_progress', priority: 2, unread: true }
  const answer = board({
    'buzzni.moai.show-all': cut,
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => (hold ? null : JSON.stringify([...JSON.parse(SHOW_ALL), only])),
    'buzzni.moai.read-all': () => readAnswer('mgd-only'),
  })
  answer.started = (op, args) => { if (args[0] === 'buzzni.moai.show-archived') archiveStarts++ }
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  // Turned off and on: a new archive read runs (held) when SPC m a lands, so it is to be read again once it answers.
  hold = true
  press(panel, ' ', 'v', 'o', 'Escape', ' ', 'v', 'o', 'Escape')
  await flush()
  panel.window.document.body.focus()
  press(panel, ' ', 'm', 'a')
  await settled(900)
  assert.equal(archiveStarts, 2)
  // Cancel stops it: what the person stopped is not started again.
  panel.$('.moai-cancel').click()
  await settled(900)
  assert.equal(archiveStarts, 2)
  assert.match(panel.$('.moai-archive-problem[role="status"]').textContent, /cancelled/i)
})

test('an archive read still running when a mark lands on a whole list is read again too, for a list that turns partial', async () => {
  let marked = false
  let whole = true
  let hold = false
  let archiveStarts = 0
  const asked = new Map()
  const review = (unread) => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'review', priority: 2, ...(unread ? { unread: true } : {}) })
  const answer = board({
    'buzzni.moai.show-all': () => (whole ? JSON.stringify([...JSON.parse(SHOW_ALL), review(!marked)]) : cut),
    'buzzni.moai.prime': PRIME,
    // Each archive run answers as the marks stood when it started.
    'buzzni.moai.show-archived': (value, op) => (hold ? null : JSON.stringify([...JSON.parse(SHOW_ALL), review(!asked.get(op))])),
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-only') },
  })
  answer.started = (op, args) => { if (args[0] === 'buzzni.moai.show-archived') { archiveStarts++; asked.set(op, marked) } }
  const panel = await runPanel(answer)
  // Archived rows turned on: their read is held running, from before the mark.
  hold = true
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  panel.row('mgd-only').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(newMarks(panel, 'mgd-only').row, null)
  // The next read is cut (prime's rows); the archive read from before the mark answers after it.
  whole = false
  panel.$('.moai-refresh').click()
  await settled(900)
  hold = false
  await settled(900)
  assert.equal(archiveStarts, 2, 'read again once the read from before the mark answered')
  assert.ok(panel.row('mgd-only'))
  assert.deepEqual([newMarks(panel, 'mgd-only').badge, newMarks(panel, 'mgd-only').row], [null, null])
})

test('a whole list that comes back as prime\'s rows reads the archive again: a mark taken while it was whole stays taken', async () => {
  let marked = false
  let whole = true
  let archiveReads = 0
  const review = () => ({ id: 'mgd-only', kind: 'issue', title: 'Only the archive answer holds me', status: 'review', priority: 2, ...(marked ? {} : { unread: true }) })
  const panel = await runPanel(board({
    'buzzni.moai.show-all': () => (whole ? JSON.stringify([...JSON.parse(SHOW_ALL), review()]) : cut),
    'buzzni.moai.prime': PRIME,
    'buzzni.moai.show-archived': () => { archiveReads++; return JSON.stringify([...JSON.parse(SHOW_ALL), review()]) },
    'buzzni.moai.read': () => { marked = true; return readAnswer('mgd-only') },
  }))
  press(panel, ' ', 'v', 'o', 'Escape')
  await settled()
  panel.row('mgd-only').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await settled(900)
  assert.equal(newMarks(panel, 'mgd-only').row, null)
  assert.equal(archiveReads, 1, 'a whole list does not read the archive again after a mark')
  // The tracker outgrows the output limit: the next read is prime's rows, and the archive answer stands in for the row.
  whole = false
  panel.$('.moai-refresh').click()
  await settled(900)
  assert.equal(archiveReads, 2)
  assert.ok(panel.row('mgd-only'))
  assert.deepEqual([newMarks(panel, 'mgd-only').badge, newMarks(panel, 'mgd-only').row], [null, null])
})

test('a declined read mark is told on the result line and the list is not read again', async () => {
  const answer = board({ 'buzzni.moai.show': SHOW_NOTE_BODY })
  answer.start = (args) => (args[0] === 'buzzni.moai.read' ? { action: 'start', state: 'refused', code: 'declined' } : null)
  const panel = await runPanel(answer)
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  const before = panel.starts().length
  press(panel, 'r')
  await flush()
  assert.deepEqual(panel.starts().slice(before), [['buzzni.moai.read', 'mgd-hmcr']])
  assert.equal(panel.$('.moai-result').textContent, 'The run did not start: the confirmation was declined.')
})

test('a load that show --all failed on its own is told at once, without waiting for the counts read beside it', async () => {
  // show --all is declined while the status read still waits for its own confirmation.
  let approve
  const answer = board()
  answer.start = (args) => {
    if (args[0] === 'buzzni.moai.show-all') return { action: 'start', state: 'refused', code: 'declined' }
    if (args[0] === 'buzzni.moai.status') return new Promise((resolve) => { approve = () => resolve(null) })
    return null
  }
  const panel = await runPanel(answer)
  assert.equal(panel.$('.moai-notice').textContent, 'The run did not start: the confirmation was declined.', 'told without waiting for the counts')
  assert.equal(panel.$('.moai-refresh').disabled, false)
  // Approved after all, the counts read runs; the failure stays told.
  approve()
  await flush()
  assert.equal(panel.$('.moai-notice').textContent, 'The run did not start: the confirmation was declined.')
})

test('Cancel stops the list reads, but an add still waiting for its confirmation is the person\'s to decline', async () => {
  let holding = false
  let approve
  const answer = board({
    'buzzni.moai.show-all': () => (holding ? null : SHOW_ALL),
    'buzzni.moai.add': (title) => JSON.stringify({ id: 'mgd-new1', title, status: 'todo' }),
  })
  answer.start = (args) => (args[0] === 'buzzni.moai.add' ? new Promise((resolve) => { approve = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  // A refresh runs (show --all held on the machine) and an add waits for its confirmation.
  holding = true
  panel.$('.moai-refresh').click()
  await flush()
  panel.$('.moai-add input').value = 'Ship it'
  panel.pressEnter(false)
  await flush()
  assert.equal(panel.$('.moai-cancel').hidden, false)
  const cancelsBefore = panel.calls.filter(([command]) => command === 'buzzni.moai.cancel').length
  panel.$('.moai-cancel').click()
  await flush()
  assert.ok(panel.calls.filter(([command]) => command === 'buzzni.moai.cancel').length > cancelsBefore, 'the running read is cancelled')
  // The person approves the add: it runs, and is not cancelled the moment it starts.
  holding = false
  const cancels = panel.calls.filter(([command]) => command === 'buzzni.moai.cancel').length
  approve()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.calls.filter(([command]) => command === 'buzzni.moai.cancel').length, cancels, 'no cancel for the approved add')
  assert.equal(panel.$('.moai-result').textContent, 'Added: Ship it (mgd-new1)')
})

test('showing archived rows keeps a row the clock moved to the archive after the archive was read', async () => {
  // `--archived` lists the active rows too: mgd-ogym is still active when the archive is read.
  let listed = SHOW_ALL
  const panel = await runPanel(board({ 'buzzni.moai.show-all': () => listed, 'buzzni.moai.show-archived': SHOW_ALL }))
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.deepEqual([...panel.rows()].sort(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  // The next show --all no longer lists it (archived by the clock); the archive is not read again.
  listed = JSON.stringify(JSON.parse(SHOW_ALL).filter((row) => row.id !== 'mgd-ogym'))
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual([...panel.rows()].sort(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'], 'it stays, now an archived row')
})

test('a refresh while the archive is still paging does not start the paging over', async () => {
  const page = (from, n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `z-${String(from + i).padStart(4, '0')}`, title: 'Old', status: 'done', kind: 'issue', priority: 3 })))
  let second = null
  const panel = await runPanel(board({ 'buzzni.moai.show-archived': page(0, 200), 'buzzni.moai.show-archived-after': () => second }))
  const archiveStarts = () => panel.starts().filter(([profile]) => profile.startsWith('buzzni.moai.show-archived'))
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await flush()
  assert.deepEqual(archiveStarts(), [['buzzni.moai.show-archived'], ['buzzni.moai.show-archived-after', 'z-0199']])
  // A refresh ends while the second page still runs.
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(archiveStarts().length, 2, 'the archive was not read from its first page again')
  second = page(200, 10)
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(archiveStarts().length, 2)
})

test('a wiki link to an issue the list does not hold shows its detail on the list tab', async () => {
  const old = { id: 'mgd-old1', title: 'Finished long ago', status: 'done', kind: 'issue' }
  const page = { slug: 'home', title: 'Home', path: 'docs/home.md', bytes: 30, issues: [{ id: 'mgd-old1', exists: true }], links: [], linked_from: [], conflict: false }
  const panel = await runPanel(board({
    'buzzni.moai.wiki-ls': JSON.stringify({ dir: 'docs', pages: [page] }),
    'buzzni.moai.wiki-show': JSON.stringify({ ...page, body: '# Home\n\nSee mgd-old1.\n' }),
    'buzzni.moai.show': (id) => (id === 'mgd-old1' ? JSON.stringify(old) : null),
  }))
  press(panel, ' ', 'g', 'w')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await flush()
  const link = panel.$('.m-pane-wiki a[data-kind="issue"][data-issue="mgd-old1"]')
  assert.ok(link, 'the page links the issue')
  link.click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.starts().at(-1), ['buzzni.moai.show', 'mgd-old1'])
  assert.equal(panel.$('[role="tab"][data-tab="list"]').getAttribute('aria-selected'), 'true')
  assert.equal(panel.$('.moai-detail h2').textContent, 'Finished long ago', 'shown, not closed as a row a reload removed')
})

test('turning archived rows off while the archive still pages drops its late answer', async () => {
  const page = (from, n) => JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: `z-${String(from + i).padStart(4, '0')}`, title: 'Old', status: 'done', kind: 'issue', priority: 0 })))
  let firstPages = 0
  let second = null
  const panel = await runPanel(board({
    // The first read's first page answers; the read after it is held on its first page.
    'buzzni.moai.show-archived': () => (++firstPages === 1 ? page(0, 200) : null),
    'buzzni.moai.show-archived-after': () => second,
  }))
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await flush()
  // Off while the second page runs; then that page answers.
  press(panel, ' ', 'v', 'o', 'Escape')
  second = page(200, 10)
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  // On again: the new read is still on its first page, so no archive row may show — the late answer was dropped.
  press(panel, ' ', 'v', 'o', 'Escape')
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual([...panel.rows()].sort(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('the rows show while the counts read still waits for its confirmation, and the counts follow when it runs', async () => {
  const status = JSON.parse(STATUS_V016)
  status.milestones[0] = { ...status.milestones[0], done: 5, total: 9 }
  let approve
  const answer = board({ 'buzzni.moai.show-all': SHOW_ALL_V016, 'buzzni.moai.backlog-all': BACKLOG_V016, 'buzzni.moai.status': JSON.stringify(status) })
  answer.start = (args) => (args[0] === 'buzzni.moai.status' ? new Promise((resolve) => { approve = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  // Not on Loading: the board counts its own rows until status answers.
  assert.ok(panel.row('tracker-e0ue'), 'the rows are drawn')
  assert.equal(countsOf(panel, 'tracker-e0ue'), '1/2')
  approve()
  await new Promise((resolve) => setTimeout(resolve, 600))
  await flush()
  assert.equal(countsOf(panel, 'tracker-e0ue'), '5/9')
  assert.equal(panel.$('.moai-error').textContent, '')
})

test('an archive read that fails is told on its own line; the board and its banners stand', async () => {
  const answer = board()
  answer.start = (args) => (args[0] === 'buzzni.moai.show-archived' ? { action: 'start', state: 'refused', code: 'declined' } : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.equal(panel.$('.moai-archive-problem').textContent, 'Archived rows could not be read: The run did not start: the confirmation was declined.')
  assert.equal(panel.$('.moai-notice').textContent, '', 'not told as the board\'s problem')
  assert.equal(panel.$('.moai-error').textContent, '')
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  // Archived rows turned off: the line goes with them.
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.equal(panel.$('.moai-archive-problem').textContent, '')
})

test('while one run goes and another waits for its confirmation, the line still asks to approve it', async () => {
  const accepts = new Map()
  const answer = () => null
  answer.start = (args) => new Promise((resolve) => accepts.set(args[0], () => resolve(null)))
  const panel = await runPanel(answer)
  // show --all is approved and runs; the backlog and status reads still wait on their confirmations.
  accepts.get('buzzni.moai.show-all')()
  await flush()
  assert.equal(panel.$('.moai-activity').textContent, 'Running on the machine… Starting… approve the confirmation if it is showing.')
  assert.equal(panel.$('.moai-cancel').hidden, false, 'something runs, so it can be cancelled')
  accepts.get('buzzni.moai.backlog-all')()
  accepts.get('buzzni.moai.status')()
  await flush()
  assert.equal(panel.$('.moai-activity').textContent, 'Running on the machine…')
})

const STATUS_V017 = await fixture('status-v017.json')
const compatLine = (panel) => [...panel.$('.moai-compat').children].map((line) => line.textContent)

test('compatibility: a whole new setup shows no banner', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.status': STATUS_V017 }))
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), [])
  assert.equal(panel.window.getComputedStyle(panel.$('.moai-compat')).display, 'none')
})

test('compatibility: a profile the daemon catalog lacks asks to update the catalog', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  // prime, which stands in for show --all, is still running: the banner does not wait for it.
  answer.start = (args) => (args[0] === 'buzzni.moai.show-all' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the whole list). Update the daemon catalog."])
  // The refusal is the banner's alone: the load does without show --all instead of failing on it.
  assert.equal(panel.$('.moai-error').textContent, '')
  assert.equal(panel.$('.moai-notice').textContent, '')
  assert.equal(panel.starts().at(-1)[0], 'buzzni.moai.prime')
})

test('compatibility: without show --all in the catalog the board falls back to prime, the catalog line naming the whole list', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017, 'buzzni.moai.prime': PRIME })
  answer.start = (args) => (args[0] === 'buzzni.moai.show-all' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  assert.deepEqual(panel.starts().map(([profile]) => profile), ['buzzni.moai.show-all', 'buzzni.moai.backlog-all', 'buzzni.moai.status', 'buzzni.moai.prime'])
  // The working reads keep showing, as the banner promises.
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the whole list). Update the daemon catalog."])
  // The catalog line says why the list is partial; the cut banner, which says it was too large, does not.
  assert.equal(panel.$('.moai-truncated').textContent, '')
  assert.equal(panel.$('.moai-error').textContent, '')
})

test('compatibility: without backlog show --all in the catalog the list stands without the backlog, the catalog line naming it', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => (args[0] === 'buzzni.moai.backlog-all' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'], 'not an empty list')
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the backlog). Update the daemon catalog."])
  assert.equal(panel.$('.moai-error').textContent, '')
  assert.equal(panel.$('.moai-truncated').textContent, '')
})

// A status without the `milestones[]`/`epics[]` tallies: the board counts its own rows, which leave archived ones out.
const STATUS_NO_TALLIES = JSON.stringify({ counts: { done: 0, in_progress: 1, review: 1, todo: 1 }, total: 3 })

test('compatibility: without show --all the load waits on the backlog read, and a late backlog refusal leaves prime alone', async () => {
  let refuse
  const answer = board({ 'buzzni.moai.status': STATUS_V017, 'buzzni.moai.prime': PRIME })
  answer.start = (args) => {
    if (args[0] === 'buzzni.moai.show-all') return { action: 'start', state: 'refused', code: 'unsupported-daemon' }
    if (args[0] === 'buzzni.moai.backlog-all') return new Promise((resolve) => { refuse = () => resolve({ action: 'start', state: 'refused', code: 'unsupported-daemon' }) })
    return null
  }
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the whole list). Update the daemon catalog."])
  assert.deepEqual(panel.rows(), [], 'still waiting on the backlog read')
  const before = panel.starts().length
  refuse()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 2 Moai profiles this panel uses (the whole list, the backlog). Update the daemon catalog."])
  assert.equal(panel.$('.moai-error').textContent, '')
  assert.equal(panel.starts().length, before, 'nothing is read again')
})

test('compatibility: a backlog refusal that lands after a declined load ended still reaches the banner, with no read again', async () => {
  let refuse
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => {
    if (args[0] === 'buzzni.moai.show-all') return { action: 'start', state: 'refused', code: 'declined' }
    if (args[0] === 'buzzni.moai.backlog-all') return new Promise((resolve) => { refuse = () => resolve({ action: 'start', state: 'refused', code: 'unsupported-daemon' }) })
    return null
  }
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), [])
  const before = panel.starts().length
  refuse()
  await flush()
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the backlog). Update the daemon catalog."])
  assert.equal(panel.starts().length, before, 'nothing is read again')
})

// The v0.8.0 rows carry no `unread` key, as a moai older than 0.17 prints none; these carry it, as a moai that knows it does.
const SHOW_ALL_UNREAD = JSON.stringify(JSON.parse(SHOW_ALL).map((row) => ({ ...row, unread: true })))

test('compatibility: moai 0.16 that prints `unread` (no statuses[], the tallies printed) is not asked to upgrade', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show-all': SHOW_ALL_UNREAD }))
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), [])
})

test('compatibility: moai 0.16 whose rows print no `unread` asks to upgrade, naming the NEW marks it leaves off', async () => {
  const panel = await runPanel(board())
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), ["That machine's moai is older than this panel expects (on a fallback: NEW marks). Upgrade moai."])
})

test('compatibility: a status without the tallies asks to upgrade moai, naming the counts, in the panel language', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.show-all': SHOW_ALL_UNREAD, 'buzzni.moai.status': STATUS_NO_TALLIES }))
  assert.deepEqual(compatLine(panel), ["That machine's moai is older than this panel expects (on a fallback: milestone and epic counts). Upgrade moai."])
  // The rows that work keep showing.
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  const ko = await runPanel(board({ 'buzzni.moai.show-all': SHOW_ALL_UNREAD, 'buzzni.moai.status': STATUS_NO_TALLIES }), 'ko')
  assert.deepEqual(compatLine(ko), ['그 머신의 moai가 이 패널이 기대하는 버전보다 오래되었습니다(대체 방식으로 동작: 마일스톤·에픽 개수). moai를 업그레이드하세요.'])
})

test('compatibility: moai missing on the machine asks to install it, told by that banner alone', async () => {
  const answer = stdoutFor({})
  answer.start = () => ({ action: 'start', state: 'refused', code: 'tool-missing' })
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), ['Moai is not installed on that machine. Install moai under Machine tools in Settings → Extensions.'])
  assert.equal(panel.$('.moai-error').textContent, '')
  assert.equal(panel.$('.moai-notice').textContent, '')
})

test('compatibility: a refusal the banner does not tell still shows as the board\'s error', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => (args[0] === 'buzzni.moai.show-all' ? { action: 'start', state: 'refused', code: 'unsupported-platform' } : null)
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), [])
  assert.equal(panel.$('.moai-error').textContent, "Moai cannot run on that machine's operating system.")
})

test('compatibility: beside a catalog line, a refusal of another kind still shows as the board\'s error', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => {
    if (args[0] === 'buzzni.moai.backlog-all') return { action: 'start', state: 'refused', code: 'unsupported-daemon' }
    if (args[0] === 'buzzni.moai.show-all') return { action: 'start', state: 'refused', code: 'unsupported-platform' }
    return null
  }
  const panel = await runPanel(answer)
  assert.equal(compatLine(panel).length, 1)
  assert.equal(panel.$('.moai-error').textContent, "Moai cannot run on that machine's operating system.")
})

test('compatibility: a report that says the same is not written again (it is a live region)', async () => {
  const panel = await runPanel(board({ 'buzzni.moai.status': STATUS_NO_TALLIES }))
  const before = panel.$('.moai-compat').firstChild
  assert.ok(before)
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-compat').firstChild, before)
})

test('a refresh keeps the counts the board showed while its own status read waits, and takes the new ones after', async () => {
  const status = JSON.parse(STATUS_V016)
  status.milestones[0] = { ...status.milestones[0], done: 5, total: 9 }
  let hold = false
  let approve
  const answer = board({ 'buzzni.moai.show-all': SHOW_ALL_V016, 'buzzni.moai.backlog-all': BACKLOG_V016, 'buzzni.moai.status': () => JSON.stringify(status) })
  answer.start = (args) => (hold && args[0] === 'buzzni.moai.status' ? new Promise((resolve) => { approve = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  assert.equal(countsOf(panel, 'tracker-e0ue'), '5/9')
  hold = true
  status.milestones[0] = { ...status.milestones[0], done: 6, total: 9 }
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(countsOf(panel, 'tracker-e0ue'), '5/9', 'not the rows\' own 1/2 while status waits')
  approve()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(countsOf(panel, 'tracker-e0ue'), '6/9')
})

test('compatibility: moai installed while the panel is open takes the install line away', async () => {
  let missing = true
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = () => (missing ? { action: 'start', state: 'refused', code: 'tool-missing' } : null)
  const panel = await runPanel(answer)
  assert.deepEqual(compatLine(panel), ['Moai is not installed on that machine. Install moai under Machine tools in Settings → Extensions.'])
  missing = false
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
  assert.deepEqual(compatLine(panel), [])
})

test('compatibility: moai installed, the refresh does not bring the install refusal back on the error banner while it runs', async () => {
  let missing = true
  let release
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => {
    if (missing) return { action: 'start', state: 'refused', code: 'tool-missing' }
    // The backlog read waits on its confirmation: the load is still running when show --all has found moai.
    if (args[0] === 'buzzni.moai.backlog-all') return new Promise((resolve) => { release = () => resolve(null) })
    return null
  }
  const panel = await runPanel(answer)
  assert.equal(panel.$('.moai-error').textContent, '')
  missing = false
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(compatLine(panel), [])
  assert.equal(panel.$('.moai-error').textContent, '', 'not "Moai is not installed" now that it ran')
  release()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('compatibility: a new report that leaves the sentences as they were does not write them again', async () => {
  let approve
  // The catalog is judged once a profile has run: the backlog read ends (passes) before show --all is refused (the load
  // then waits on prime, which stands in and is never answered here). A macrotask apart, not an ordering of microtasks.
  let backlogRan
  const ran = new Promise((resolve) => { backlogRan = resolve })
  const answer = board({ 'buzzni.moai.status': STATUS_V017, 'buzzni.moai.backlog-all': () => (backlogRan(), NO_BACKLOG) })
  answer.start = (args) => {
    if (args[0] === 'buzzni.moai.show-all') return ran.then(() => new Promise((resolve) => setTimeout(resolve, 0))).then(() => ({ action: 'start', state: 'refused', code: 'unsupported-daemon' }))
    if (args[0] === 'buzzni.moai.status') return new Promise((resolve) => { approve = () => resolve(null) })
    return null
  }
  const panel = await runPanel(answer)
  const before = panel.$('.moai-compat').firstChild
  assert.equal(before?.textContent, "That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (the whole list). Update the daemon catalog.")
  // status answers: moai is found up to date, which the banner does not name.
  approve()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-compat').firstChild, before, 'the live region is left alone')
})

test('an archive read that fails with an error is told as an alert, information as status text', async () => {
  const answer = board()
  answer.start = (args) => (args[0] === 'buzzni.moai.show-archived' ? { action: 'start', state: 'refused', code: 'unsupported-platform' } : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.equal(panel.$('.moai-archive-problem[role="alert"]').textContent, "Archived rows could not be read: Moai cannot run on that machine's operating system.")
  assert.equal(panel.$('.moai-archive-problem[role="status"]').textContent, '')
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('compatibility: an archive profile the catalog lacks is told by the banner, not again on the archive line', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => (args[0] === 'buzzni.moai.show-archived' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (archived rows). Update the daemon catalog."])
  assert.equal(panel.$('.moai-archive-problem[role="alert"]').textContent, '')
  assert.equal(panel.$('.moai-archive-problem[role="status"]').textContent, '')
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('compatibility: beside a catalog line for other profiles, a hidden detail\'s refusal is still told', async () => {
  // The detail's `show` is not a read the probe hears, so the catalog line (archived rows) does not stand for it.
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => (['buzzni.moai.show-archived', 'buzzni.moai.show'].includes(args[0]) ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  press(panel, ' ', 'v', 'o', 'Escape')
  await flush()
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (archived rows). Update the daemon catalog."])
  panel.$('.moai-detail-toggle').click()
  panel.row('mgd-hmcr').click()
  await flush()
  assert.equal(panel.$('.moai-error').textContent, "That machine's Saycode runtime is too old to run Moai. Update the runtime, then try again.")
})

test('compatibility: a read mark the catalog lacks is told by the banner, not again under the add field', async () => {
  const answer = board({ 'buzzni.moai.status': STATUS_V017 })
  answer.start = (args) => (args[0] === 'buzzni.moai.read' ? { action: 'start', state: 'refused', code: 'unsupported-daemon' } : null)
  const panel = await runPanel(answer)
  panel.row('mgd-hmcr').click()
  await flush()
  panel.window.document.body.focus()
  press(panel, 'r')
  await flush()
  assert.deepEqual(compatLine(panel), ["That machine's Happy daemon catalog lacks 1 Moai profile this panel uses (read marks). Update the daemon catalog."])
  assert.equal(panel.$('.moai-result').textContent, '', 'not "the runtime is too old" beside "update the catalog"')
})

test('while a refresh\'s status read still waits, a refresh asked for reads the rows again and shares that status read', async () => {
  let hold = false
  const approvals = []
  const answer = board()
  answer.start = (args) => (hold && args[0] === 'buzzni.moai.status' ? new Promise((resolve) => approvals.push(() => resolve(null))) : null)
  const panel = await runPanel(answer)
  hold = true
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(panel.$('.moai-refresh').disabled, false)
  const before = panel.starts().length
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.starts().slice(before), [['buzzni.moai.show-all'], ['buzzni.moai.backlog-all']], 'not swallowed by the load still waiting')
  assert.equal(approvals.length, 1, 'status is not asked for again')
  approvals[0]()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(panel.rows(), ['mgd-89af', 'mgd-hmcr', 'mgd-ogym'])
})

test('a read mark reads the list again at once, though the status read of the load before still waits', async () => {
  let hold = false
  let approve
  const answer = board({ 'buzzni.moai.show': SHOW_NOTE_BODY, 'buzzni.moai.read': READ_ONE_V016 })
  answer.start = (args) => (hold && args[0] === 'buzzni.moai.status' ? new Promise((resolve) => { approve = () => resolve(null) }) : null)
  const panel = await runPanel(answer)
  panel.row('mgd-hmcr').click()
  await flush()
  hold = true
  panel.$('.moai-refresh').click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  panel.window.document.body.focus()
  const before = panel.starts().length
  press(panel, 'r')
  await new Promise((resolve) => setTimeout(resolve, 1200))
  await flush()
  assert.deepEqual(panel.starts().slice(before), [['buzzni.moai.read', 'mgd-hmcr'], ['buzzni.moai.show-all'], ['buzzni.moai.backlog-all']])
  approve()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
})

test('compatibility: the banner speaks Japanese and Chinese too', async () => {
  const ja = await runPanel(board({ 'buzzni.moai.status': STATUS_NO_TALLIES }), 'ja')
  assert.deepEqual(compatLine(ja), ['そのマシンの moai は、このパネルが想定するバージョンより古いです（代わりの方法で動作中: NEW 表示、マイルストーンとエピックの件数）。moai をアップグレードしてください。'])
  const zh = await runPanel(board({ 'buzzni.moai.status': STATUS_NO_TALLIES }), 'zh')
  assert.deepEqual(compatLine(zh), ['该机器上的 moai 比此面板预期的版本旧（正以替代方式运行：NEW 标记、里程碑和史诗的计数）。请升级 moai。'])
})
