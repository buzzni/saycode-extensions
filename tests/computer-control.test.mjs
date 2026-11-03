import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

test('CUA package declares exact pinned artifacts and cannot request control without managed metadata', async () => {
  const raw = JSON.parse(await readFile(new URL('../packages/computer-control/extension.json', import.meta.url)))
  const parsed = parseExtensionManifest(raw, { supportedApiVersion: 3 })
  assert.equal(parsed.managedLocalTool.toolVersion, '0.38.0')
  // 0.38 returns only the markdown tree by default; the Chrome recipe and agents read `elements` too.
  assert.equal(parsed.managedLocalTool.operations.snapshot.payload.tree_format, 'both')
  assert.equal(parsed.managedLocalTool.operations.click.payload.session, '{{session}}')
  assert.deepEqual(parsed.managedLocalTool.operations.status.argv, ['status'])
  assert.deepEqual(parsed.managedLocalTool.operations.autostartKick.argv, ['autostart', 'kick'])
  assert.throws(() => parseExtensionManifest({ ...raw, managedLocalTool: undefined }, { supportedApiVersion: 3 }), /metadata required/)
  assert.throws(() => parseExtensionManifest({ ...raw, apiVersion: 2 }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /API version 3/)
})

// A fake Desktop broker for the Windows doctor: records every capability call and refuses unknown request keys
// the way Desktop's managedLocalToolBroker does (specs/windows-computer-control-no-uac).
function windowsBroker({ background = { state: 'not-registered', legacyElevated: 0 }, removeLegacy = 'removed', ensure = 'registered', runningAfter = ['ensure'], status } = {}) {
  const calls = []
  const handler = async (permission, action, input) => {
    const keys = Object.keys(input ?? {}).sort().join(',')
    const allowed = action === 'run' ? 'machineId,operation,parameters,version' : action === 'background' ? 'machineId,mode,version' : 'machineId,version'
    if (keys !== allowed) throw new Error('INVALID_REQUEST')
    calls.push({ permission, action, step: action === 'background' ? 'background:' + input.mode : input.operation })
    if (action === 'background') {
      if (input.mode === 'status') return { version: 1, ...background }
      if (input.mode === 'removeLegacy') { if (removeLegacy instanceof Error) throw removeLegacy; return { version: 1, state: removeLegacy } }
      if (input.mode === 'ensure') { if (ensure instanceof Error) throw ensure; return { version: 1, state: ensure } }
    }
    if (action !== 'run') return { version: 1, state: 'cancelled' }
    if (input.operation === 'version') return { state: 'succeeded', output: 'cua-driver 0.38.0' }
    if (input.operation === 'status') {
      if (status) return status(calls)
      const up = calls.some(call => runningAfter.some(step => call.step === step || call.step === 'background:' + step))
      if (!up) throw new Error('TOOL_EXECUTION_FAILED')
      return { state: 'succeeded', output: 'running\n' }
    }
    if (['autostartKick', 'stop'].includes(input.operation)) return { state: 'succeeded', output: 'ok\n' }
    if (input.operation === 'doctor') return { state: 'succeeded', output: JSON.stringify({ ok: true }) }
    throw new Error(`unexpected operation ${input.operation}`)
  }
  return { calls, handler }
}
const windowsDoctor = provider => provider.command('doctor')({ version: 1, machineId: 'M1', platform: 'win32' })

test('Windows doctor registers the standard-privilege background task without any administrator approval', async () => {
  const broker = windowsBroker()
  const provider = await loadProvider(broker.handler)
  try {
    assert.deepEqual(await windowsDoctor(provider), { version: 1, state: 'ready' })
    assert.deepEqual(broker.calls.map(call => call.step), ['version', 'background:status', 'background:ensure', 'status', 'doctor'])
    assert.equal(broker.calls.find(call => call.step === 'background:ensure').permission, 'localTools.control')
    assert.equal(broker.calls.some(call => /autostart(Enable)?$/.test(call.step ?? '') && call.step !== 'autostartKick'), false)
  } finally { await provider.cleanup() }
})

test('doctor refuses a 0.32.0 Driver left over from an older install', async () => {
  const broker = windowsBroker()
  const handler = broker.handler
  const provider = await loadProvider(async (permission, action, input) => action === 'run' && input?.operation === 'version'
    ? { state: 'succeeded', output: 'cua-driver 0.32.0' } : handler(permission, action, input))
  try {
    await assert.rejects(windowsDoctor(provider), /DRIVER_VERSION_MISMATCH/)
  } finally { await provider.cleanup() }
})

test('Windows doctor never forwards the platform field to Desktop’s broker', async () => {
  const broker = windowsBroker()
  const provider = await loadProvider(broker.handler)
  try {
    await windowsDoctor(provider)
    assert.ok(broker.calls.length > 0)
  } finally { await provider.cleanup() }
})

test('Windows doctor leaves a registered, current and running task alone', async () => {
  const broker = windowsBroker({ background: { state: 'registered', runLevel: 'Limited', executableMatches: true, legacyElevated: 0 }, runningAfter: ['version'] })
  const provider = await loadProvider(broker.handler)
  try {
    assert.deepEqual(await windowsDoctor(provider), { version: 1, state: 'ready' })
    assert.deepEqual(broker.calls.map(call => call.step), ['version', 'background:status', 'status', 'status', 'doctor'])
  } finally { await provider.cleanup() }
})

test('Windows doctor re-registers a task that points at an older Driver path', async () => {
  const broker = windowsBroker({ background: { state: 'registered', runLevel: 'Limited', executableMatches: false, legacyElevated: 0 }, runningAfter: ['version'] })
  const provider = await loadProvider(broker.handler)
  try {
    await windowsDoctor(provider)
    assert.ok(broker.calls.some(call => call.step === 'background:ensure'))
  } finally { await provider.cleanup() }
})

test('Windows doctor does not treat a negative daemon status as running', async () => {
  const broker = windowsBroker({ status: () => ({ state: 'succeeded', output: 'daemon is not running\n' }) })
  const provider = await loadProvider(broker.handler)
  try {
    await assert.rejects(windowsDoctor(provider), /LOCAL_DAEMON_REQUIRED/)
    assert.deepEqual(broker.calls.map(call => call.step), ['version', 'background:status', 'background:ensure', 'status', 'status', 'status', 'status', 'status', 'status', 'status'])
  } finally { await provider.cleanup() }
})

test('Windows doctor maps a failed registration to DRIVER_AUTOSTART_REQUIRED', async () => {
  const broker = windowsBroker({ ensure: new Error('LOGON_TASK_SCRIPT_FAILED') })
  const provider = await loadProvider(broker.handler)
  try {
    await assert.rejects(windowsDoctor(provider), /DRIVER_AUTOSTART_REQUIRED/)
  } finally { await provider.cleanup() }
})

test('Windows doctor removes the 0.2.1 elevated task with one approval and moves to the standard task', async () => {
  const broker = windowsBroker({ background: { state: 'not-registered', legacyElevated: 1 } })
  const provider = await loadProvider(broker.handler)
  try {
    assert.deepEqual(await windowsDoctor(provider), { version: 1, state: 'ready' })
    assert.deepEqual(broker.calls.map(call => call.step), ['version', 'background:status', 'background:removeLegacy', 'stop', 'background:ensure', 'status', 'doctor'])
    assert.equal(broker.calls.find(call => call.step === 'background:removeLegacy').permission, 'localTools.control')
  } finally { await provider.cleanup() }
})

test('Windows doctor keeps the legacy elevated task working when the approval is declined', async () => {
  const broker = windowsBroker({ background: { state: 'not-registered', legacyElevated: 1 }, removeLegacy: 'declined', runningAfter: ['autostartKick'] })
  const provider = await loadProvider(broker.handler)
  try {
    assert.deepEqual(await windowsDoctor(provider), { version: 1, state: 'ready', legacyElevated: true })
    assert.deepEqual(broker.calls.map(call => call.step), ['version', 'background:status', 'background:removeLegacy', 'status', 'autostartKick', 'status', 'doctor'])
  } finally { await provider.cleanup() }
})

test('CUA package declares a literal background argv and no longer registers the elevated task', async () => {
  const { parseManagedLocalTool } = await import('../packages/sdk/dist/managedLocalTool.js')
  const raw = JSON.parse(await readFile(new URL('../packages/computer-control/extension.json', import.meta.url)))
  const parsed = parseManagedLocalTool(raw.managedLocalTool, raw.id)
  assert.deepEqual(parsed.background, { argv: ['serve'], stopOperation: 'stop' })
  assert.equal(parsed.operations.autostartEnable, undefined)
  assert.equal(raw.engines.saycode, '^1.3.0')
  for (const background of [{ argv: ['serve', '{{session}}'] }, { argv: ['serve'], stopOperation: 'snapshot' }, { argv: ['serve'], stopOperation: 'missing' }, { argv: [] }]) {
    assert.throws(() => parseManagedLocalTool({ ...raw.managedLocalTool, background }, raw.id), /INVALID_TOOL_DESCRIPTOR/)
  }
  const macOnly = structuredClone(raw.managedLocalTool)
  delete macOnly.platforms['win32-x64']
  assert.throws(() => parseManagedLocalTool(macOnly, raw.id), /INVALID_TOOL_DESCRIPTOR/)
})

test('Chrome recipe hands off ambiguity, verifies developer mode after action and never guesses file-picker targets', async t => {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-recipe-'))
  try {
    const output = join(temporary, 'recipe.mjs')
    await build({ entryPoints: ['packages/computer-control/src/chromeRecipe.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
    const { prepareUnpackedChrome } = await import(pathToFileURL(output).href)
    const calls = []
    let snapshots = 0
    const invoke = async (operation, parameters) => {
      calls.push({ operation, parameters })
      if (operation === 'windows') return { windows: [{ app_name: 'Google Chrome', title: '확장 프로그램', pid: 12, window_id: 34 }] }
      if (operation === 'snapshot') return ++snapshots === 1 ? { elements: [{ label: '개발자 모드', role: 'AXStaticText', element_token: 'snapshot1-label', actions: [] }, { label: '개발자 모드', role: 'AXCheckBox', value: '0', element_token: 'snapshot1-toggle', actions: ['AXPress'] }] } : { elements: [{ label: '압축해제된 확장 프로그램 로드', role: 'AXButton', element_token: 'snapshot2-load', actions: ['AXPress'] }] }
      return {}
    }
    assert.equal((await prepareUnpackedChrome(invoke)).reason, 'choose-extension-directory')
    assert.deepEqual(calls.filter(call => call.operation === 'click').map(call => call.parameters.elementToken), ['snapshot1-toggle', 'snapshot2-load'])
    assert.equal((await prepareUnpackedChrome(async () => ({ windows: [] }))).state, 'manual-required')
    const unchanged = await prepareUnpackedChrome(async operation => operation === 'windows' ? { windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] } : { elements: [{ label: 'Developer mode', role: 'AXCheckBox', value: '0', element_token: 'unchanged', actions: ['AXPress'] }] })
    assert.equal(unchanged.reason, 'load-unpacked')
    for (const unavailable of [{ truncated: true }, { degraded_reason: 'accessibility permission lost' }]) {
      await t.test(`rejects refreshed snapshot: ${JSON.stringify(unavailable)}`, async () => {
        const clicked = []; let reads = 0
        const handoff = await prepareUnpackedChrome(async (operation, parameters) => {
          if (operation === 'windows') return { windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] }
          if (operation === 'snapshot') return ++reads === 1
            ? { elements: [{ label: 'Developer mode', role: 'AXCheckBox', value: '0', element_token: 'toggle', actions: ['AXPress'] }] }
            : { ...unavailable, elements: [{ label: 'Load unpacked', role: 'AXButton', element_token: 'load', actions: ['AXPress'] }] }
          if (operation === 'click') clicked.push(parameters.elementToken)
          return {}
        })
        assert.equal(handoff.reason, 'accessibility-unavailable')
        assert.deepEqual(clicked, ['toggle'])
      })
    }
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

test('provider verifies an unverifiable AX click through a fresh snapshot instead of stopping before its postcondition', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-provider-'))
  try {
    const output = join(temporary, 'provider.mjs')
    await build({ entryPoints: ['packages/computer-control/src/index.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
    const provider = (await import(pathToFileURL(output).href)).default
    const commands = new Map(); const calls = []; let snapshots = 0
    await provider.activate({ commands: { register: (name, handler) => commands.set(name, handler) }, invokeCapability: async (_permission, action, input) => {
      calls.push({ action, input })
      if (action === 'management') return { version: 1, state: 'manual-required', extensionDirectory: '/active-cli/browser-extension' }
      if (action === 'cancel') return { version: 1, state: 'cancelled', remoteMayContinue: false }
      const operation = input.operation
      if (operation === 'windows') return { state: 'succeeded', output: JSON.stringify({ windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] }) }
      if (operation === 'snapshot') return { state: 'succeeded', output: JSON.stringify({ elements: ++snapshots === 1
        ? [{ label: 'Developer mode', role: 'AXCheckBox', value: '0', actions: ['AXPress'], element_token: 'toggle' }]
        : [{ label: 'Load unpacked', role: 'AXButton', actions: ['AXPress'], element_token: 'load' }] }) }
      return { state: 'succeeded', output: JSON.stringify({ route: 'accessibility', effect: 'unverifiable' }) }
    } })
    const handoff = await commands.get('buzzni.computer-control.automate')({ version: 1, machineId: 'M1', profile: 'Default' })
    assert.equal(handoff.reason, 'choose-extension-directory')
    assert.equal(handoff.extensionDirectory, '/active-cli/browser-extension')
    assert.equal(snapshots, 2)
    assert.deepEqual(calls.filter(call => call.input.operation === 'click').map(call => call.input.parameters.elementToken), ['toggle', 'load'])
    assert.equal(calls.at(-1).action, 'cancel')
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

async function panelFixture() {
  const calls = [], releases = []
  // Load the packaged panel straight from disk into a real DOM, as the Core iframe would.
  const dom = await JSDOM.fromFile(fileURLToPath(new URL('../packages/computer-control/panel.html', import.meta.url)), { runScripts: 'dangerously', beforeParse(window) {
    window.saycodePanel = { ready: Promise.resolve(), invokeCommand: (command, args) => { calls.push({ command, args }); return new Promise(resolve => releases.push(resolve)) } }
  } })
  const document = dom.window.document
  const elements = Object.fromEntries(['machine', 'profile', 'profiles', 'actions', 'cancel', 'result'].map(id => [id, document.getElementById(id)]))
  const buttons = ['pair', 'status'].map(action => document.querySelector(`[data-action="${action}"]`))
  const option = document.createElement('option'); option.value = 'Default'; option.textContent = 'Default'; elements.profile.append(option)
  elements.machine.value = 'M1'; elements.profile.value = 'Default'
  return { elements, buttons, calls, releases }
}
test('panel locks its target and cancels the original machine despite input changes', async () => {
  const { elements, buttons, calls, releases } = await panelFixture()
  const pairing = buttons[0].onclick()
  assert.equal(elements.machine.disabled, true)
  assert.equal(elements.profile.disabled, true)
  assert.equal(elements.profiles.disabled, true)
  elements.machine.value = 'M2'
  const cancel = elements.cancel.onclick()
  assert.equal(calls[1].args[0].machineId, 'M1')
  releases[1]({ state: 'cancelled' }); await cancel
  releases[0]({ state: 'connected' }); await pairing
})
test('panel ignores a cancelled operation response and its finalizer during a new operation', async () => {
  const { elements, buttons, releases } = await panelFixture()
  const pairing = buttons[0].onclick()
  const cancel = elements.cancel.onclick()
  releases[1]({ state: 'cancelled' }); await cancel
  const checking = buttons[1].onclick()
  releases[0]({ state: 'connected' }); await pairing
  assert.match(elements.result.textContent, /cancelled/)
  assert.equal(elements.actions.disabled, true)
  assert.equal(elements.cancel.hidden, false)
  releases[2]({ state: 'idle' }); await checking
  assert.match(elements.result.textContent, /idle/)
  assert.equal(elements.machine.disabled, false)
})

test('provider keeps its automation gate until cancelled native work and final cleanup settle', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-provider-cancel-'))
  try {
    const output = join(temporary, 'provider.mjs')
    await build({ entryPoints: ['packages/computer-control/src/index.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
    const provider = (await import(pathToFileURL(output).href)).default
    const commands = new Map(), calls = []
    let releaseWindows, releaseCleanup, cleanups = 0
    await provider.activate({ commands: { register: (name, handler) => commands.set(name, handler) }, invokeCapability: async (_permission, action, input) => {
      calls.push({ action, input })
      if (action === 'management') return { version: 1, state: 'manual-required', extensionDirectory: '/active-cli/browser-extension' }
      if (action === 'cancel') {
        if (input.operation === undefined && _permission === 'localTools.control' && ++cleanups === 2) return new Promise(resolve => { releaseCleanup = resolve })
        return { version: 1, state: 'cancelled', remoteMayContinue: false }
      }
      return new Promise(resolve => { releaseWindows = resolve })
    } })
    const input = { version: 1, machineId: 'M1', profile: 'Default' }
    const command = name => commands.get('buzzni.computer-control.' + name)
    const original = command('automate')(input).catch(error => error)
    while (!releaseWindows) await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(command('cancel')({ version: 1, machineId: 'M2' }), /NOT_OWNED/)
    let cancelled = false
    const cancellation = command('cancel')({ version: 1, machineId: 'M1' }).then(value => { cancelled = true; return value })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(cancelled, false)
    await assert.rejects(command('automate')(input), /BUSY/)
    releaseWindows({ state: 'succeeded', output: JSON.stringify({ windows: [] }) })
    while (!releaseCleanup) await new Promise(resolve => setImmediate(resolve))
    await assert.rejects(command('automate')(input), /BUSY/)
    releaseCleanup({ version: 1, state: 'cancelled', remoteMayContinue: false })
    assert.match(String(await original), /CANCELLED/)
    assert.equal((await cancellation).state, 'cancelled')
    assert.equal(calls.filter(call => call.action === 'management').length, 1)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

test('provider exposes unconfirmed Driver cleanup instead of reporting an ordinary manual handoff', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-provider-cleanup-'))
  try {
    const output = join(temporary, 'provider.mjs')
    await build({ entryPoints: ['packages/computer-control/src/index.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
    const provider = (await import(pathToFileURL(output).href)).default
    const commands = new Map()
    await provider.activate({ commands: { register: (name, handler) => commands.set(name, handler) }, invokeCapability: async (_permission, action) => {
      if (action === 'management') return { version: 1, state: 'manual-required', extensionDirectory: '/active-cli/browser-extension' }
      if (action === 'cancel') return { version: 1, state: 'cancelled', remoteMayContinue: true }
      return { state: 'succeeded', output: JSON.stringify({ windows: [] }) }
    } })
    const handoff = await commands.get('buzzni.computer-control.automate')({ version: 1, machineId: 'M1', profile: 'Default' })
    assert.equal(handoff.remoteMayContinue, true)
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

async function loadProvider(invokeCapability) {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-provider-review-'))
  const output = join(temporary, 'provider.mjs')
  await build({ entryPoints: ['packages/computer-control/src/index.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
  const provider = (await import(pathToFileURL(output).href)).default
  const commands = new Map()
  await provider.activate({ commands: { register: (name, handler) => commands.set(name, handler) }, invokeCapability })
  return { command: name => commands.get('buzzni.computer-control.' + name), cleanup: () => rm(temporary, { recursive: true, force: true }) }
}

test('Stop during a Driver-only action never revokes an existing browser pairing', async () => {
  const calls = []
  let releaseInstall
  const provider = await loadProvider(async (permission, action) => {
    calls.push({ permission, action })
    if (action === 'install') return new Promise(resolve => { releaseInstall = resolve })
    return { version: 1, state: 'cancelled', remoteMayContinue: false }
  })
  try {
    const install = provider.command('install')({ version: 1, machineId: 'M1' }).catch(error => error)
    while (!releaseInstall) await new Promise(resolve => setImmediate(resolve))
    const stopped = await provider.command('cancel')({ version: 1, machineId: 'M1' })
    releaseInstall({ version: 1, state: 'cancelled' })
    await install
    assert.equal(stopped.state, 'cancelled')
    assert.deepEqual(calls.filter(call => call.permission === 'localBrowser.setup'), [])
  } finally { await provider.cleanup() }
})

test('Stop during browser pairing still cancels the in-flight setup', async () => {
  const calls = []
  let releasePair
  const provider = await loadProvider(async (permission, action) => {
    calls.push({ permission, action })
    if (action === 'pair') return new Promise(resolve => { releasePair = resolve })
    return { version: 1, state: 'cancelled', remoteMayContinue: false }
  })
  try {
    const pair = provider.command('pair')({ version: 1, machineId: 'M1', profile: 'Default' })
    while (!releasePair) await new Promise(resolve => setImmediate(resolve))
    await provider.command('cancel')({ version: 1, machineId: 'M1' })
    releasePair({ version: 1, state: 'revoked' })
    await pair
    assert.ok(calls.some(call => call.permission === 'localBrowser.setup' && call.action === 'cancel'))
  } finally { await provider.cleanup() }
})

test('provider returns the handoff with remoteMayContinue when only the final Driver cleanup fails', async () => {
  const provider = await loadProvider(async (_permission, action) => {
    if (action === 'management') return { version: 1, state: 'manual-required', extensionDirectory: '/active-cli/browser-extension' }
    if (action === 'cancel') throw new Error('TOOL_REVOCATION_UNCONFIRMED')
    return { state: 'succeeded', output: JSON.stringify({ windows: [] }) }
  })
  try {
    const handoff = await provider.command('automate')({ version: 1, machineId: 'M1', profile: 'Default' })
    assert.equal(handoff.extensionDirectory, '/active-cli/browser-extension')
    assert.equal(handoff.remoteMayContinue, true)
  } finally { await provider.cleanup() }
})

test('Chrome recipe never switches Developer mode off and ignores pages that only start with the Extensions title', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'cua-recipe-review-'))
  try {
    const output = join(temporary, 'recipe.mjs')
    await build({ entryPoints: ['packages/computer-control/src/chromeRecipe.ts'], outfile: output, bundle: true, format: 'esm', platform: 'node' })
    const { prepareUnpackedChrome } = await import(pathToFileURL(output).href)
    const clicks = []
    const enabled = await prepareUnpackedChrome(async (operation, parameters) => {
      if (operation === 'windows') return { windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] }
      if (operation === 'click') { clicks.push(parameters.elementToken); return {} }
      return { elements: [{ label: 'Developer mode', role: 'AXCheckBox', value: '1', element_token: 'toggle', actions: ['AXPress'] }] }
    })
    assert.equal(enabled.reason, 'load-unpacked')
    assert.deepEqual(clicks, [])
    const lookalike = await prepareUnpackedChrome(async operation => operation === 'windows'
      ? { windows: [{ app_name: 'Google Chrome', title: 'Extensions guide - Chrome for Developers', pid: 1, window_id: 2 }] } : { elements: [] })
    assert.equal(lookalike.reason, 'select-chrome-window')
  } finally { await rm(temporary, { recursive: true, force: true }) }
})

test('managed tool metadata requires API 3 and rejects malformed URLs, values and oversized payloads', async () => {
  const { parseManagedLocalTool } = await import('../packages/sdk/dist/managedLocalTool.js')
  const raw = JSON.parse(await readFile(new URL('../packages/computer-control/extension.json', import.meta.url)))
  const tool = raw.managedLocalTool
  const id = raw.id
  assert.throws(() => parseExtensionManifest({ ...raw, apiVersion: 2, permissions: raw.permissions.filter(p => !p.startsWith('local')) }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /API version 3/)
  const clone = () => structuredClone(tool)
  const badUrl = clone(); badUrl.platforms['darwin-arm64'].url = 'not a url'
  assert.throws(() => parseManagedLocalTool(badUrl, id), /INVALID_TOOL_DESCRIPTOR/)
  const short = clone(); short.operations.snapshot.inputs.extra = { type: 'string', maxLength: 2 }
  short.operations.snapshot.payload.extra = '{{extra}}'
  assert.doesNotThrow(() => parseManagedLocalTool(short, id))
  const badValues = clone(); badValues.operations.snapshot.inputs.extra = { type: 'string', maxLength: 2, values: ['toolong'] }
  badValues.operations.snapshot.payload.extra = '{{extra}}'
  assert.throws(() => parseManagedLocalTool(badValues, id), /INVALID_TOOL_DESCRIPTOR/)
  let deep = {}; for (let i = 0; i < 64; i++) deep = { nested: deep }
  const nested = clone(); nested.operations.snapshot.payload.deep = deep
  assert.throws(() => parseManagedLocalTool(nested, id), /INVALID_TOOL_DESCRIPTOR/)
})

const runResult = output => ({ version: 1, state: 'succeeded', output: typeof output === 'string' ? output : JSON.stringify(output) })
// Desktop's answer to the macOS background (LaunchAgent) requests; `registered` is an agent for the current Driver.
const macBackground = (input, { registered = false, ensure = 'registered' } = {}) => input.mode === 'status'
  ? { version: 1, ...(registered ? { state: 'registered', executableMatches: true } : { state: 'not-registered' }), legacyElevated: 0 }
  : { version: 1, state: ensure }
const step = (action, input) => action === 'background' ? 'background:' + input.mode : input.operation
test('OS permission check starts the CuaDriver daemon and requests grants when it is not running', async () => {
  const operations = []
  let granted = false
  const provider = await loadProvider(async (permission, action, input) => {
    operations.push(step(action, input))
    if (action === 'background') return macBackground(input)
    if (action !== 'run') return { version: 1, state: 'installed' }
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    if (input.operation === 'grant') { granted = true; return runResult('Accessibility and Screen Recording are granted.') }
    if (input.operation === 'permissionStatus') return runResult(granted
      ? { accessibility: true, screen_recording: true, source: { attribution: 'driver-daemon' } }
      : { daemon_running: false, status: 'unknown' })
    throw new Error('unexpected ' + input.operation)
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'ready' })
    assert.deepEqual(operations, ['version', 'background:status', 'background:ensure', 'permissionStatus', 'grant', 'permissionStatus'])
  } finally { await provider.cleanup() }
})
test('OS permission check registers the LaunchAgent with control permission and leaves a current one alone', async () => {
  const calls = []
  const provider = await loadProvider(async (permission, action, input) => {
    calls.push({ permission, step: step(action, input) })
    if (action === 'background') return macBackground(input, { registered: true })
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    return runResult({ accessibility: true, screen_recording: true })
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'ready' })
    assert.deepEqual(calls.map(call => call.step), ['version', 'background:status', 'permissionStatus'])
    assert.equal(calls.find(call => call.step === 'background:status').permission, 'localTools.inspect')
  } finally { await provider.cleanup() }
  const ensured = []
  const second = await loadProvider(async (permission, action, input) => {
    ensured.push({ permission, step: step(action, input) })
    if (action === 'background') return macBackground(input)
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    return runResult({ accessibility: true, screen_recording: true })
  })
  try {
    await second.command('doctor')({ version: 1, machineId: 'M1' })
    assert.equal(ensured.find(call => call.step === 'background:ensure').permission, 'localTools.control')
  } finally { await second.cleanup() }
})
test('OS permission check keeps working on a Desktop without the macOS background task', async () => {
  const operations = []
  const provider = await loadProvider(async (permission, action, input) => {
    operations.push(step(action, input))
    if (action === 'background') return { version: 1, state: 'unsupported-platform', platform: 'darwin-arm64' }
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    return runResult({ accessibility: true, screen_recording: true })
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'ready' })
    assert.deepEqual(operations, ['version', 'background:status', 'permissionStatus'])
  } finally { await provider.cleanup() }
})
test('Stop while registering the LaunchAgent ends the OS permission check', async () => {
  const provider = await loadProvider(async (permission, action, input) => {
    if (action === 'background') return input.mode === 'ensure' ? { version: 1, state: 'cancelled', remoteMayContinue: false } : macBackground(input)
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    return runResult({ daemon_running: false, status: 'unknown' })
  })
  try {
    await assert.rejects(provider.command('doctor')({ version: 1, machineId: 'M1' }), /cancelled/)
  } finally { await provider.cleanup() }
})
test('OS permission check does not prompt again when the daemon already has both grants', async () => {
  const operations = []
  const provider = await loadProvider(async (permission, action, input) => {
    operations.push(step(action, input))
    if (action === 'background') return macBackground(input, { registered: true })
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    return runResult({ accessibility: true, screen_recording: true })
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'ready' })
    assert.deepEqual(operations, ['version', 'background:status', 'permissionStatus'])
  } finally { await provider.cleanup() }
})
test('OS permission check reports pending grants when macOS approval is still outstanding', async () => {
  const provider = await loadProvider(async (permission, action, input) => {
    if (action === 'background') return macBackground(input)
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    if (input.operation === 'grant') throw new Error('TOOL_EXECUTION_FAILED')
    return runResult({ accessibility: false, screen_recording: true })
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'permissions-required' })
  } finally { await provider.cleanup() }
})
test('CUA package declares the grant and permission status operations it needs on a fresh machine', async () => {
  const raw = JSON.parse(await readFile(new URL('../packages/computer-control/extension.json', import.meta.url)))
  const { operations } = parseExtensionManifest(raw, { supportedApiVersion: 3 }).managedLocalTool
  assert.deepEqual(operations.grant.argv, ['permissions', 'grant'])
  assert.deepEqual(operations.permissionStatus.argv, ['permissions', 'status', '--json'])
})
test('OS permission check falls back to doctor when permission status is not JSON (no macOS permissions command)', async () => {
  const operations = []
  const provider = await loadProvider(async (permission, action, input) => {
    operations.push(step(action, input))
    if (action === 'background') return macBackground(input, { registered: true })
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    if (input.operation === 'permissionStatus') return runResult('permissions options (macOS):\n  cua-driver permissions status ...')
    if (input.operation === 'doctor') return runResult({ ok: true })
    if (input.operation === 'permissions') return runResult({ accessibility: true, screen_recording: true })
    throw new Error('unexpected ' + input.operation)
  })
  try {
    assert.deepEqual(await provider.command('doctor')({ version: 1, machineId: 'M1' }), { version: 1, state: 'ready' })
    assert.deepEqual(operations, ['version', 'background:status', 'permissionStatus', 'doctor', 'permissions'])
  } finally { await provider.cleanup() }
})
test('Stop during the macOS grant ends the OS permission check instead of carrying on', async () => {
  const operations = []
  const provider = await loadProvider(async (permission, action, input) => {
    operations.push(step(action, input))
    if (action === 'background') return macBackground(input, { registered: true })
    if (input.operation === 'version') return runResult('cua-driver 0.38.0\n')
    if (input.operation === 'grant') return { version: 1, state: 'cancelled', remoteMayContinue: false }
    return runResult({ daemon_running: false, status: 'unknown' })
  })
  try {
    await assert.rejects(provider.command('doctor')({ version: 1, machineId: 'M1' }), /cancelled/)
    assert.deepEqual(operations, ['version', 'background:status', 'permissionStatus', 'grant'])
  } finally { await provider.cleanup() }
})
