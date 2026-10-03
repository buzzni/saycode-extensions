import assert from 'node:assert/strict'
import { test } from 'node:test'
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
      if (action === 'management' || action === 'cancel') return { version: 1, state: 'cancelled', remoteMayContinue: false }
      const operation = input.operation
      if (operation === 'windows') return { state: 'succeeded', output: JSON.stringify({ windows: [{ app_name: 'Google Chrome', title: 'Extensions', pid: 1, window_id: 2 }] }) }
      if (operation === 'snapshot') return { state: 'succeeded', output: JSON.stringify({ elements: ++snapshots === 1
        ? [{ label: 'Developer mode', role: 'AXCheckBox', actions: ['AXPress'], element_token: 'toggle' }]
        : [{ label: 'Load unpacked', role: 'AXButton', actions: ['AXPress'], element_token: 'load' }] }) }
      return { state: 'succeeded', output: JSON.stringify({ route: 'accessibility', effect: 'unverifiable' }) }
    } })
    assert.equal((await commands.get('buzzni.computer-control.automate')({ version: 1, machineId: 'M1', profile: 'Default' })).reason, 'choose-extension-directory')
    assert.equal(snapshots, 2)
    assert.deepEqual(calls.filter(call => call.input.operation === 'click').map(call => call.input.parameters.elementToken), ['toggle', 'load'])
    assert.equal(calls.at(-1).action, 'cancel')
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
