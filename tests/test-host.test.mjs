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
