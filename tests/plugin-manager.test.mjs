import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import JSZip from 'jszip'

import { createTestHost } from '../packages/test-host/dist/index.js'

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')
const packageRoot = join(root, 'packages/plugin-manager')

async function packedPluginManager() {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-plugin-manager-'))
  const archivePath = join(temporary, 'plugin-manager.saycode-extension')
  await exec('node', [cli, 'pack', packageRoot, '--output', archivePath])
  const zip = await JSZip.loadAsync(await readFile(archivePath))
  const modulePath = join(temporary, 'index.mjs')
  await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
  const extension = (await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)).default
  return { temporary, zip, extension }
}

const plugin = {
  id: 'sample@marketplace',
  name: 'sample',
  marketplace: 'marketplace',
  version: '1.2.3',
  scope: 'user',
  enabled: false,
}

class FakeElement {
  textContent = ''
  className = ''
  type = ''
  checked = false
  disabled = false
  children = []
  listeners = new Map()
  append(...children) { this.children.push(...children) }
  replaceChildren(...children) { this.children = children }
  addEventListener(type, listener) { this.listeners.set(type, listener) }
  dispatch(type) { this.listeners.get(type)?.({ target: this }) }
}

async function flushPanel() {
  await new Promise((resolve) => setImmediate(resolve))
  await new Promise((resolve) => setImmediate(resolve))
}

async function runPanel(zip, invokeCommand, language = 'en') {
  const html = await zip.file('panel.html').async('string')
  const script = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)?.[1]
  assert.ok(script)
  const ids = Object.fromEntries(['title', 'refresh', 'hint', 'status', 'error', 'plugins']
    .map((id) => [id, new FakeElement()]))
  const document = {
    getElementById(id) { return ids[id] },
    createElement() { return new FakeElement() },
  }
  const window = { saycodePanel: { ready: Promise.resolve(), invokeCommand } }
  Function('window', 'document', 'navigator', script)(window, document, { language })
  await flushPanel()
  return ids
}

test('official Plugin Manager uses only the public machine.execute capability', async () => {
  const packed = await packedPluginManager()
  const calls = []
  try {
    const host = createTestHost('buzzni.plugin-manager', {
      async invokeCapability(permission, action, args) {
        calls.push({ permission, action, args })
        return { plugins: [{ ...plugin, enabled: action === 'enable' }] }
      },
    })
    await host.activate(packed.extension)

    assert.equal(await host.invokeCommand('buzzni.plugin-manager.open', []), null)
    assert.deepEqual(await host.invokeCommand('buzzni.plugin-manager.list', []), { plugins: [plugin] })
    await host.invokeCommand('buzzni.plugin-manager.enable', [plugin.id])
    await host.invokeCommand('buzzni.plugin-manager.disable', [plugin.id])
    assert.deepEqual(calls, [
      { permission: 'machine.execute', action: 'list', args: {} },
      { permission: 'machine.execute', action: 'enable', args: { pluginId: plugin.id } },
      { permission: 'machine.execute', action: 'disable', args: { pluginId: plugin.id } },
    ])
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('Plugin Manager rejects malformed capability responses and packages its isolated UI', async () => {
  const packed = await packedPluginManager()
  try {
    const host = createTestHost('buzzni.plugin-manager', {
      async invokeCapability() { return { plugins: [{ id: 'missing-required-fields', enabled: true }] } },
    })
    await host.activate(packed.extension)
    await assert.rejects(host.invokeCommand('buzzni.plugin-manager.list', []), /plugin response/i)

    const panel = await packed.zip.file('panel.html').async('string')
    for (const marker of ['Plugins', '플러그인', 'プラグイン', '插件']) assert.match(panel, new RegExp(marker))
    assert.match(panel, /scope === 'user'/)
    assert.match(panel, /requestGeneration/)
    assert.doesNotMatch(panel, /electron|ipcRenderer|Desktop internal|@buzzni\/saycode-core/)
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('isolated panel keeps request order, user-only toggles, and rollback on failure', async () => {
  const packed = await packedPluginManager()
  let listCall = 0
  let resolveStale
  const projectPlugin = { ...plugin, id: 'project@marketplace', name: 'project', scope: 'project' }
  try {
    const elements = await runPanel(packed.zip, async (command) => {
      if (command === 'buzzni.plugin-manager.enable') throw new Error('toggle failed')
      listCall += 1
      if (listCall === 1) return { plugins: [plugin, projectPlugin] }
      if (listCall === 2) return new Promise((resolve) => { resolveStale = resolve })
      return { plugins: [{ ...plugin, name: 'latest' }] }
    })

    let [userRow, projectRow] = elements.plugins.children
    assert.equal(userRow.children[0].disabled, false)
    assert.equal(projectRow.children[0].disabled, true)
    userRow.children[0].checked = true
    userRow.children[0].dispatch('change')
    await flushPanel()
    ;[userRow] = elements.plugins.children
    assert.equal(userRow.children[0].checked, false)
    assert.equal(elements.error.textContent, 'Could not change the plugin setting.')

    elements.refresh.dispatch('click')
    elements.refresh.dispatch('click')
    await flushPanel()
    ;[userRow] = elements.plugins.children
    assert.equal(userRow.children[1].children[0].textContent, 'latest')
    resolveStale({ plugins: [{ ...plugin, name: 'stale' }] })
    await flushPanel()
    ;[userRow] = elements.plugins.children
    assert.equal(userRow.children[1].children[0].textContent, 'latest')
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})
