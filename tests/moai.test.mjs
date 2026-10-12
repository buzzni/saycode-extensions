import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
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

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setImmediate(resolve)) }
const PANEL_IDS = ['hint', 'check', 'refresh', 'task', 'add', 'cancel', 'spinner', 'status', 'counts', 'result', 'notice', 'error', 'board', 'detail', 'back', 'detail-title', 'detail-meta', 'detail-body', 'detail-children', 'detail-journal']
const panelWindows = []
after(() => { for (const window of panelWindows) window.close() })

const fixture = async (name) => readFile(new URL(`./fixtures/moai/${name}`, import.meta.url), 'utf8')
// Real Moai v0.8.0 output, read up front: file I/O inside a handler would outlast the panel's flushes.
const PRIME = await fixture('prime-v080.json')
const PRIME_NO_TRACKER = await fixture('prime-no-tracker-v080.json')
const SHOW_NOTE_BODY = await fixture('show-note-body-v080.json')
const SHOW_MOVED = await fixture('show-moved-v080.json')
const EMPTY_BOARD = JSON.stringify({ picked: [], ready: [], rest: 0, others: [], others_rest: 0 })

/**
 * Runs the packed panel in a real DOM, wrapped the way Desktop's panel document wraps it. The board loads its
 * list when it opens; unless `board` is null, that first load is answered with `board` (an empty board by
 * default) before `invokeCommand` sees any call, so a test observes only what it does itself.
 */
async function runPanel(invokeCommand, language = 'en', board = EMPTY_BOARD) {
  const html = await packedPanelHtml()
  let opening = board !== null
  const respond = async (command, args) => {
    if (opening && command === 'buzzni.moai.run' && args[0] === 'buzzni.moai.prime') return { action: 'start', operationId: 'opening-board', state: 'accepted' }
    if (opening && command === 'buzzni.moai.status' && args[0] === 'opening-board') {
      opening = false
      return { action: 'status', operationId: 'opening-board', state: 'passed', stdout: board, stderr: '', exitCode: 0 }
    }
    return invokeCommand(command, args)
  }
  const dom = new JSDOM(`<!doctype html><html lang="${language}"><head></head><body>${html}</body></html>`, {
    runScripts: 'dangerously',
    // Arguments cross a MessagePort in Desktop; copying them here also keeps assertions in this realm.
    beforeParse(window) { window.saycodePanel = { ready: Promise.resolve(), invokeCommand: (command, args) => respond(command, structuredClone(args)) } },
  })
  panelWindows.push(dom.window)
  await flush()
  const ids = Object.fromEntries(PANEL_IDS.map((id) => [id, dom.window.document.getElementById(id)]))
  return Object.assign(ids, {
    window: dom.window,
    pressEnter(isComposing) {
      ids.task.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', isComposing, bubbles: true, cancelable: true }))
    },
  })
}

test('a project tool opens the Moai board panel in the work area instead of a machine settings button', async () => {
  const parsed = parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
  const open = parsed.contributes.commands.find((command) => command.id === 'buzzni.moai.open')
  assert.equal(open?.panelId, 'buzzni.moai.panel')
  // The host owns the panel title; compact asks for the small modal preset where a host still opens a modal.
  assert.deepEqual(parsed.contributes.panels, [{ id: 'buzzni.moai.panel', title: 'Moai', entrypoint: 'panel.html', surfaceSize: 'compact' }])
  assert.deepEqual(parsed.contributes.projectTools, [{ id: 'buzzni.moai.board', title: 'Moai', command: 'buzzni.moai.open' }])
  assert.equal(parsed.contributes.machineActions, undefined)
  // Project tools need a Desktop with engine 1.2.0; an older one refuses the manifest instead of misreading it.
  assert.equal(parsed.engines.saycode, '^1.2.0')
  assert.ok(parsed.activationEvents.includes('onCommand:buzzni.moai.open'))
  const host = createTestHost('buzzni.moai', { async invokeCapability() { throw new Error('not expected') } })
  await host.activate(extension)
  assert.equal(await host.invokeCommand('buzzni.moai.open', []), null)
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
  elements.check.click()
  await flush()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.status']])
  assert.deepEqual(calls.slice(1).map(([command, args]) => [command, args]), [['buzzni.moai.status', ['op-1']], ['buzzni.moai.status', ['op-1']]])
  assert.equal(elements.counts.hidden, false)
  assert.deepEqual([...elements.counts.querySelectorAll('li')].map((chip) => [chip.querySelector('.stat-value').textContent, chip.querySelector('.stat-label').textContent]),
    [['3', 'To do'], ['1', 'In progress'], ['0', 'Review'], ['5', 'Done']])
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
  elements.add.click()
  await flush()
  assert.equal(calls.length, 0)
  assert.equal(elements.error.textContent, '할 일 제목을 입력하세요.')
  elements.task.value = '  Fix checkout  '
  elements.add.click()
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.add', 'Fix checkout']])
  assert.equal(elements.result.textContent, '추가했습니다: Fix checkout (shop-7)')
  assert.equal(elements.task.value, '')
})

test('a refused or unsupported start is explained and leaves the board usable', async () => {
  const elements = await runPanel(async () => { throw new Error('capability.invoke machine.run/start failed: binding-mismatch') })
  elements.check.click()
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
  elements.add.click()
  await flush()
  assert.equal(elements.error.textContent, 'Moai reported an error: the git user details are not there')
})

test('the board follows the host document language and only talks to its own commands', async () => {
  const elements = await runPanel(async () => null, 'ja')
  assert.equal(elements.hint.textContent, 'このプロジェクトのフォルダで実行します。初めて読み取るときと、タスクを追加するたびに、マシンとフォルダを示す確認画面が表示されます。')
  assert.equal(elements.check.textContent, '状態を表示')
  const html = await packedPanelHtml()
  for (const command of html.matchAll(/invokeCommand\('([^']+)'/g)) assert.match(command[1], /^buzzni\.moai\./)
  assert.doesNotMatch(html, /electron|ipcRenderer|innerHTML/)
})

// Real Moai v0.8.0 output: errors go to stderr, and status outside a `.moai/` repository lists projects instead of counts.
const NOT_A_REPOSITORY = JSON.stringify({ code: 'error', error: 'Not a moai repository (no `.moai/` found). Start one with `moai init`, or call a repository elsewhere with `moai -C <dir> <command>`' })
const NOT_INITIALIZED_EN = 'This project has no Moai board yet. On that machine, run moai init once in the project folder, then try again. If moai is not found, run it from the Moai path shown under Machine tools in Settings → Extensions.'

/** The init guidance is information, not an error: it renders in the info banner with the command as code. */
function assertInitGuidance(elements, text) {
  assert.equal(elements.notice.hidden, false)
  assert.equal(elements.notice.textContent, text)
  assert.equal(elements.notice.querySelector('code')?.textContent, 'moai init')
  assert.ok(elements.notice.classList.contains('info'))
  assert.doesNotMatch(elements.notice.textContent, /`/)
  assert.equal(elements.error.textContent, '')
}

test('adding to a project without a Moai board explains how to start one', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-4', state: 'accepted' }
    : { action: 'status', operationId: 'op-4', state: 'failed', stdout: '', stderr: NOT_A_REPOSITORY, exitCode: 1 })
  elements.task.value = 'Write docs'
  elements.add.click()
  await flush()
  assertInitGuidance(elements, NOT_INITIALIZED_EN)
})

test('status in a project without a Moai board explains how to start one', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-5', state: 'accepted' }
    : { action: 'status', operationId: 'op-5', state: 'passed', stdout: JSON.stringify({ projects: [], problems: [], config: '/home/me/.config/moai/config.toml' }), stderr: '', exitCode: 0 }, 'ko')
  elements.check.click()
  await flush()
  assertInitGuidance(elements, '이 프로젝트에는 아직 Moai 보드가 없습니다. 그 머신의 프로젝트 폴더에서 moai init을 한 번 실행한 뒤 다시 시도하세요. moai를 찾을 수 없으면 설정 → 확장의 머신 도구에 표시된 Moai 경로로 실행하세요.')
  assert.equal(elements.result.textContent, '')
  assert.equal(elements.counts.hidden, true)
})

test('a failed run shows the reason Moai printed on stderr', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-6', state: 'accepted' }
    : { action: 'status', operationId: 'op-6', state: 'failed', stdout: '', stderr: JSON.stringify({ code: 'no_actor', error: 'the git user details are not there' }), exitCode: 1 })
  elements.task.value = 'Write docs'
  elements.add.click()
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
  elements.pressEnter(false)
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.add', 'Ship it']])
  // An IME composing Hangul also reports Enter; that keystroke must not add the half-typed title.
  calls.length = 0
  elements.task.value = '한글'
  elements.pressEnter(true)
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
  elements.check.click()
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
  elements.check.click()
  await flush()
  assert.equal(elements.status.textContent, 'The run was cancelled.')
})

test('the board leaves the title to the host and keeps the guidance out of the chat', async () => {
  const html = await packedPanelHtml()
  assert.doesNotMatch(html, /<h1/)
  // Init stays a user action on the machine (spec: separate high-risk capability), never a chat request.
  assert.doesNotMatch(html, /\bAI\b|chat|채팅|チャット|聊天/i)
})

test('cancel appears only once the run has an operation id, and the spinner only while it runs', async () => {
  let accept
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return new Promise((resolve) => { accept = resolve })
    if (command === 'buzzni.moai.cancel') return { action: 'cancel', operationId: 'op-10', state: 'cancelled' }
    return calls.some(([name]) => name === 'buzzni.moai.cancel')
      ? { action: 'status', operationId: 'op-10', state: 'cancelled', remoteMayContinue: false }
      : { action: 'status', operationId: 'op-10', state: 'running' }
  })
  assert.equal(elements.cancel.hidden, true)
  assert.equal(elements.spinner.hidden, true)
  elements.check.click()
  await flush()
  // Waiting on the confirmation dialog: nothing to cancel yet.
  assert.equal(elements.cancel.hidden, true)
  assert.equal(elements.spinner.hidden, false)
  assert.equal(elements.check.disabled, true)
  accept({ action: 'start', operationId: 'op-10', state: 'accepted' })
  await flush()
  assert.equal(elements.cancel.hidden, false)
  assert.equal(elements.cancel.disabled, false)
  elements.cancel.click()
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.deepEqual(calls.find(([name]) => name === 'buzzni.moai.cancel'), ['buzzni.moai.cancel', ['op-10']])
  assert.equal(elements.status.textContent, 'The run was cancelled.')
  assert.equal(elements.cancel.hidden, true)
  assert.equal(elements.spinner.hidden, true)
})

test('a new run clears the previous counts, notice, and error', async () => {
  let mode = 'init'
  const elements = await runPanel(async (command) => {
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-11', state: 'accepted' }
    return mode === 'init'
      ? { action: 'status', operationId: 'op-11', state: 'failed', stdout: '', stderr: NOT_A_REPOSITORY, exitCode: 1 }
      : { action: 'status', operationId: 'op-11', state: 'passed', stdout: JSON.stringify({ counts: { todo: 1, in_progress: 0, review: 0, done: 0 } }), exitCode: 0 }
  })
  elements.check.click()
  await flush()
  assert.equal(elements.notice.hidden, false)
  mode = 'ok'
  elements.check.click()
  await flush()
  assert.equal(elements.notice.hidden, true)
  assert.equal(elements.counts.hidden, false)
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

const REFUSALS = {
  declined: { where: 'notice', en: 'The run did not start: the confirmation was declined.', ko: '확인 창에서 거부해 실행하지 않았습니다.', ja: '確認画面で拒否されたため、実行しませんでした。', zh: '已在确认窗口中拒绝，因此未运行。' },
  'approval-timeout': { where: 'notice', en: 'The confirmation was not answered in time, so nothing ran. Try again.', ko: '확인 창에 시간 안에 응답하지 않아 실행하지 않았습니다. 다시 시도하세요.', ja: '確認画面に時間内に応答がなかったため、実行しませんでした。もう一度お試しください。', zh: '未在规定时间内回应确认窗口，因此未运行。请重试。' },
  'workspace-busy': { where: 'notice', en: 'Another change is still running in this folder on that machine. Try again when it finishes.', ko: '그 머신의 이 폴더에서 다른 변경이 아직 실행 중입니다. 끝난 뒤 다시 시도하세요.', ja: 'そのマシンのこのフォルダでは、別の変更がまだ実行中です。終了してからもう一度お試しください。', zh: '该机器的此文件夹中仍有其他更改正在运行。请在其结束后重试。' },
  'tool-missing': { where: 'error', en: 'Moai is not installed on that machine. Install it for that machine under Machine tools in Settings → Extensions.', ko: '그 머신에 Moai가 설치되어 있지 않습니다. 설정 → 확장의 머신 도구에서 그 머신에 Moai를 설치하세요.', ja: 'そのマシンに Moai がインストールされていません。設定 → 拡張機能のマシンツールから、そのマシンに Moai をインストールしてください。', zh: '该机器上未安装 Moai。请在「设置 → 扩展」的机器工具中为该机器安装 Moai。' },
  'unsupported-platform': { where: 'error', en: "Moai cannot run on that machine's operating system.", ko: '그 머신의 운영체제에서는 Moai를 실행할 수 없습니다.', ja: 'そのマシンの OS では Moai を実行できません。', zh: '该机器的操作系统无法运行 Moai。' },
  'unsupported-daemon': { where: 'error', en: "That machine's Saycode runtime is too old to run Moai. Update the runtime, then try again.", ko: '그 머신의 Saycode 런타임이 오래되어 Moai를 실행할 수 없습니다. 런타임을 업데이트한 뒤 다시 시도하세요.', ja: 'そのマシンの Saycode ランタイムが古いため、Moai を実行できません。ランタイムを更新してから、もう一度お試しください。', zh: '该机器的 Saycode 运行时版本过旧，无法运行 Moai。请更新运行时后重试。' },
}

test('each refusal code is explained in all four languages; user choices are information, machine problems errors', async () => {
  for (const [code, expected] of Object.entries(REFUSALS)) {
    for (const language of ['en', 'ko', 'ja', 'zh']) {
      const calls = []
      const elements = await runPanel(async (command) => { calls.push(command); return { action: 'start', state: 'refused', code } }, language)
      elements.check.click()
      await flush()
      const other = expected.where === 'notice' ? 'error' : 'notice'
      assert.equal(elements[expected.where].textContent, expected[language], `${code} in ${language}`)
      assert.equal(elements[other].textContent, '', `${code} in ${language} stays out of #${other}`)
      if (expected.where === 'notice') assert.equal(elements.notice.hidden, false)
      assert.deepEqual(calls, ['buzzni.moai.run'], 'a refused run is never polled')
      assert.equal(elements.check.disabled, false)
      assert.equal(elements.cancel.hidden, true)
    }
  }
})

test('refusals without a specific message keep the generic not-started explanation', async () => {
  for (const code of ['binding-mismatch', 'invalid-request', 'something-new']) {
    const elements = await runPanel(async () => ({ action: 'start', state: 'refused', code }))
    elements.check.click()
    await flush()
    assert.equal(elements.error.textContent, 'The run did not start. It may have been declined, or this machine does not support Moai yet.')
  }
})

const groups = (elements) => [...elements.board.querySelectorAll('section.group')].map((group) => [
  group.querySelector('h2').textContent,
  [...group.querySelectorAll('button.task')].map((item) => item.querySelector('.task-title').textContent),
])

test('the board lists in-progress, review and to-do tasks from prime when it opens', async () => {
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-p', state: 'accepted' }
    return { action: 'status', operationId: 'op-p', state: 'passed', stdout: PRIME, stderr: '', exitCode: 0 }
  }, 'ko', null)
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.prime']])
  assert.deepEqual(groups(elements), [['진행 중', ['버튼으로 추가한 할 일']], ['검토', ['리뷰할 일']], ['할 일', ['가이드 첫 할 일']]])
  assert.equal(elements.board.hidden, false)
  assert.equal(elements.detail.hidden, true)
})

test('a truncated list says how many more tasks there are', async () => {
  const board = JSON.stringify({ picked: [], ready: [{ id: 'a-1', title: 'First', status: 'todo', priority: 2 }], rest: 4, others: [], others_rest: 2 })
  const elements = await runPanel(async () => null, 'en', board)
  assert.match(elements.board.textContent, /6 more not shown/)
})

test('an empty board says so instead of showing empty sections', async () => {
  const elements = await runPanel(async () => null, 'en')
  assert.deepEqual(groups(elements), [])
  assert.match(elements.board.textContent, /No open tasks/)
})

test('opening a project without a Moai board explains how to start one', async () => {
  const elements = await runPanel(async () => null, 'en', PRIME_NO_TRACKER)
  assertInitGuidance(elements, NOT_INITIALIZED_EN)
  assert.deepEqual(groups(elements), [])
})

test('choosing a task shows its details in the same panel, and Back returns to the list', async () => {
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: 'op-s', state: 'accepted' }
    return { action: 'status', operationId: 'op-s', state: 'passed', stdout: SHOW_NOTE_BODY, stderr: '', exitCode: 0 }
  }, 'ko', PRIME)
  const item = [...elements.board.querySelectorAll('button.task')].find((button) => button.textContent.includes('가이드 첫 할 일'))
  item.click()
  await flush()
  assert.deepEqual(calls[0], ['buzzni.moai.run', ['buzzni.moai.show', 'mgd-hmcr']])
  assert.equal(elements.board.hidden, true)
  assert.equal(elements.detail.hidden, false)
  assert.equal(elements['detail-title'].textContent, '가이드 첫 할 일')
  const meta = Object.fromEntries([...elements['detail-meta'].querySelectorAll('dt')].map((term) => [term.textContent, term.nextElementSibling.textContent]))
  assert.equal(meta['상태'], '할 일')
  assert.equal(meta['우선순위'], 'P2')
  assert.equal(meta['담당자'], 'dev')
  assert.equal(meta['ID'], 'mgd-hmcr')
  assert.equal(elements['detail-body'].textContent, '본문 첫 줄\n둘째 줄')
  const journal = [...elements['detail-journal'].querySelectorAll('li')].map((entry) => entry.querySelector('.journal-text').textContent)
  assert.deepEqual(journal, ['만들었습니다', '메모 하나'])
  assert.match(elements['detail-children'].textContent, /하위 항목 없음/)
  assert.equal(elements.window.document.activeElement, elements.back)

  elements.back.click()
  assert.equal(elements.detail.hidden, true)
  assert.equal(elements.board.hidden, false)
  assert.equal(elements.window.document.activeElement.textContent.includes('가이드 첫 할 일'), true)
})

test('a status move in the history reads as from and to states', async () => {
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? { action: 'start', operationId: 'op-m', state: 'accepted' }
    : { action: 'status', operationId: 'op-m', state: 'passed', stdout: SHOW_MOVED, stderr: '', exitCode: 0 }, 'en', PRIME)
  ;[...elements.board.querySelectorAll('button.task')].find((button) => button.textContent.includes('mgd-ogym')).click()
  await flush()
  const journal = [...elements['detail-journal'].querySelectorAll('li')].map((entry) => entry.querySelector('.journal-text').textContent)
  assert.deepEqual(journal, ['Created', 'To do → In progress'])
  assert.equal(elements['detail-body'].hidden, true)
})

test('adding a task refreshes the list', async () => {
  const calls = []
  const elements = await runPanel(async (command, args) => {
    calls.push([command, args])
    if (command === 'buzzni.moai.run') return { action: 'start', operationId: `op-${args[0]}`, state: 'accepted' }
    return args[0] === 'op-buzzni.moai.add'
      ? { action: 'status', operationId: args[0], state: 'passed', stdout: JSON.stringify({ id: 'mgd-new', title: 'New one', status: 'todo' }), exitCode: 0 }
      : { action: 'status', operationId: args[0], state: 'passed', stdout: JSON.stringify({ picked: [], ready: [{ id: 'mgd-new', title: 'New one', status: 'todo', priority: 2 }], rest: 0, others: [], others_rest: 0 }), exitCode: 0 }
  })
  elements.task.value = 'New one'
  elements.add.click()
  await flush()
  await flush()
  assert.deepEqual(calls.filter(([command]) => command === 'buzzni.moai.run').map(([, args]) => args[0]), ['buzzni.moai.add', 'buzzni.moai.prime'])
  assert.deepEqual(groups(elements), [['To do', ['New one']]])
  assert.equal(elements.result.textContent, 'Added: New one (mgd-new)')
})

test('Refresh reloads the list, and task buttons wait while a run is in flight', async () => {
  let accept
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? new Promise((resolve) => { accept = resolve })
    : { action: 'status', operationId: 'op-r', state: 'passed', stdout: PRIME, exitCode: 0 }, 'en', PRIME)
  elements.refresh.click()
  await flush()
  assert.ok([...elements.board.querySelectorAll('button.task')].every((button) => button.disabled))
  accept({ action: 'start', operationId: 'op-r', state: 'accepted' })
  await flush()
  assert.ok([...elements.board.querySelectorAll('button.task')].every((button) => !button.disabled))
})

test('the hint says the board runs in this project and when it asks for confirmation, in every language', async () => {
  const hints = {
    en: "Runs in this project's folder. A confirmation showing the machine and folder appears the first time it reads, and each time you add a task.",
    ko: '이 프로젝트 폴더에서 실행됩니다. 처음 읽을 때와 할 일을 추가할 때마다 머신과 폴더를 보여주는 확인 창이 뜹니다.',
    zh: '在此项目的文件夹中运行。首次读取以及每次添加任务时，都会显示机器和文件夹的确认窗口。',
  }
  for (const [language, hint] of Object.entries(hints)) {
    assert.equal((await runPanel(async () => null, language)).hint.textContent, hint, language)
  }
})

test('until the run is accepted the board says it is starting and may be waiting for the confirmation, then that it runs', async () => {
  let accept
  let finished = false
  const elements = await runPanel(async (command) => command === 'buzzni.moai.run'
    ? new Promise((resolve) => { accept = resolve })
    : finished
      ? { action: 'status', operationId: 'op-w', state: 'passed', stdout: JSON.stringify({ counts: { todo: 0, in_progress: 0, review: 0, done: 0 } }), exitCode: 0 }
      : { action: 'status', operationId: 'op-w', state: 'running' }, 'ko')
  elements.check.click()
  await flush()
  // Nothing has started yet: Desktop may be showing its confirmation.
  assert.equal(elements.status.textContent, '시작하는 중… 확인 창이 떠 있으면 승인하세요.')
  accept({ action: 'start', operationId: 'op-w', state: 'accepted' })
  await flush()
  assert.equal(elements.status.textContent, '머신에서 실행하는 중…')
  finished = true
  await new Promise((resolve) => setTimeout(resolve, 700))
  await flush()
  assert.equal(elements.status.textContent, '')
})
