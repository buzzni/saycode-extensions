import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defineExtension } from '../packages/sdk/dist/index.js'
import { createTestHost } from '../packages/test-host/dist/index.js'

test('public SDK defines and runs an extension without Desktop internals', async () => {
  const extension = defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.hello', (name) => `hello ${String(name)}`)
    },
  })
  const host = createTestHost('buzzni.test')
  await host.activate(extension)
  assert.equal(await host.invokeCommand('buzzni.test.hello', ['world']), 'hello world')
})

test('test host injects the same capability contract exposed by Desktop', async () => {
  const calls = []
  const extension = defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.plugins', () =>
        context.invokeCapability('machine.execute', 'list', {}))
    },
  })
  const host = createTestHost('buzzni.test', {
    async invokeCapability(permission, action, args) {
      calls.push({ permission, action, args })
      return { plugins: [] }
    },
  })

  await host.activate(extension)

  assert.deepEqual(await host.invokeCommand('buzzni.test.plugins', []), { plugins: [] })
  assert.deepEqual(calls, [{ permission: 'machine.execute', action: 'list', args: {} }])
})

test('test host rejects unavailable capabilities with the Desktop-shaped context', async () => {
  const extension = defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.plugins', () =>
        context.invokeCapability('machine.execute', 'list', {}))
    },
  })
  const host = createTestHost('buzzni.test')
  await host.activate(extension)

  await assert.rejects(host.invokeCommand('buzzni.test.plugins', []), /capability is unavailable/i)
})
