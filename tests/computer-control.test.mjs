import assert from 'node:assert/strict'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { build } from 'esbuild'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

test('CUA package declares exact pinned artifacts and cannot request control without managed metadata', async () => {
  const raw = JSON.parse(await readFile(new URL('../packages/computer-control/extension.json', import.meta.url)))
  const parsed = parseExtensionManifest(raw, { supportedApiVersion: 3 })
  assert.equal(parsed.managedLocalTool.toolVersion, '0.32.0')
  assert.equal(parsed.managedLocalTool.operations.click.payload.session, '{{session}}')
  assert.throws(() => parseExtensionManifest({ ...raw, managedLocalTool: undefined }, { supportedApiVersion: 3 }), /metadata required/)
  assert.throws(() => parseExtensionManifest({ ...raw, apiVersion: 2 }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /API version 3/)
})
test('Chrome recipe hands off ambiguity, verifies developer mode after action and never guesses file-picker targets', async () => {
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
      if (operation === 'snapshot') return ++snapshots === 1 ? { elements: [{ label: '개발자 모드', role: 'AXStaticText', element_token: 'snapshot1-label', actions: [] }, { label: '개발자 모드', role: 'AXCheckBox', element_token: 'snapshot1-toggle', actions: ['AXPress'] }] } : { elements: [{ label: '압축해제된 확장 프로그램 로드', role: 'AXButton', element_token: 'snapshot2-load', actions: ['AXPress'] }] }
      return {}
    }
    assert.equal((await prepareUnpackedChrome(invoke)).reason, 'choose-extension-directory')
    assert.deepEqual(calls.filter(call => call.operation === 'click').map(call => call.parameters.elementToken), ['snapshot1-toggle', 'snapshot2-load'])
    assert.equal((await prepareUnpackedChrome(async () => ({ windows: [] }))).state, 'manual-required')
    const unchanged = await prepareUnpackedChrome(async operation => operation === 'windows' ? { windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] } : { elements: [{ label: 'Developer mode', role: 'AXCheckBox', element_token: 'unchanged', actions: ['AXPress'] }] })
    assert.equal(unchanged.reason, 'load-unpacked')
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
        ? [{ label: 'Developer mode', role: 'AXCheckBox', actions: ['AXPress'], element_token: 'toggle' }]
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
  const html = await readFile(new URL('../packages/computer-control/panel.html', import.meta.url), 'utf8')
  const elements = Object.fromEntries(['machine', 'profile', 'profiles', 'actions', 'cancel', 'result'].map(id => [id, { value: '', disabled: false, hidden: false, replaceChildren() {}, append() {} }]))
  const buttons = ['pair', 'status'].map(action => ({ dataset: { action } }))
  const calls = [], releases = []
  runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], {
    document: { getElementById: id => elements[id], querySelectorAll: () => buttons, createElement: () => ({}) },
    window: { saycodePanel: { invokeCommand: (command, args) => { calls.push({ command, args }); return new Promise(resolve => releases.push(resolve)) } } },
  })
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
