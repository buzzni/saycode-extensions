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

test('failed activation leaves no partial commands and can be retried', async () => {
  const host = createTestHost('buzzni.test')
  await assert.rejects(host.activate(defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.partial', () => 'partial')
      throw new Error('activation failed')
    },
  })), /activation failed/)

  await assert.rejects(host.invokeCommand('buzzni.test.partial', []), /not registered/)
  await host.activate(defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.healthy', () => 'healthy')
    },
  }))

  assert.equal(await host.invokeCommand('buzzni.test.healthy', []), 'healthy')
})

test('failed deactivation still removes registered commands and allows a new activation', async () => {
  const host = createTestHost('buzzni.test')
  await host.activate(defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.stale', () => 'stale')
    },
    async deactivate() {
      throw new Error('deactivate failed')
    },
  }))

  await assert.rejects(host.deactivate(), /deactivate failed/)
  await assert.rejects(host.invokeCommand('buzzni.test.stale', []), /not registered/)
  await host.activate(defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.fresh', () => 'fresh')
    },
  }))
  assert.equal(await host.invokeCommand('buzzni.test.fresh', []), 'fresh')
})

test('delivers non-secret connection lifecycle to a registered channel contribution', async () => {
  const seen = []
  const host = createTestHost('example.channel')
  await host.activate({ activate(context) {
    context.channels.register('example.channel.telegram', event => { seen.push(event) })
  } })
  const event = { apiVersion: 1, channelId: 'example.channel.telegram', state: 'start',
    connectionId: 'c1', provider: 'telegram', connectionRevision: 1 }
  await host.deliverChannelLifecycle(event)
  await host.deliverChannelLifecycle({ ...event, state: 'stop' })
  assert.deepEqual(seen, [event, { ...event, state: 'stop' }])
  await host.deactivate()
  await assert.rejects(host.deliverChannelLifecycle(event), /not active/)
})

test('registers a namespaced reply formatter without exposing destination or secrets', async () => {
  const host = createTestHost('example.channel')
  const input = { apiVersion: 1, channelId: 'example.channel.telegram', connectionId: 'c1',
    provider: 'telegram', connectionRevision: 1, requestId: 'r1', kind: 'final',
    text: '한😀글', maxChunkUtf16Units: 3, maxChunks: 2 }
  await host.activate({ activate(context) {
    context.channels.registerFormatter(input.channelId, request => {
      assert.deepEqual(request, input)
      return { chunks: ['한😀', '글'] }
    })
  } })
  assert.deepEqual(await host.formatChannelReply(input), { chunks: ['한😀', '글'] })
  await host.deactivate()
  await assert.rejects(host.formatChannelReply(input), /not active/)
  await assert.rejects(host.activate({ activate(context) {
    context.channels.registerFormatter('other.channel.telegram', () => ({ chunks: [] }))
  } }), /namespaced/)
})

test('passes only Core-supplied approval presentation to the formatter', async () => {
  const host = createTestHost('example.channel')
  const input = { apiVersion: 1, channelId: 'example.channel.slack', connectionId: 'c1',
    provider: 'slack', connectionRevision: 1, requestId: 'r1', kind: 'approval',
    text: 'A decision is required.', maxChunkUtf16Units: 3000, maxChunks: 1,
    approval: { approvalHandle: 'approval-1', approveLabel: 'Approve once', denyLabel: 'Deny' } }
  const result = { chunks: [input.text], blocks: [
    { type: 'section', text: { type: 'plain_text', text: input.text } },
    { type: 'actions', elements: ['approve', 'deny'].map(decision => ({ type: 'button',
      action_id: `saycode:${decision}:${input.approval.approvalHandle}`,
      text: { type: 'plain_text', text: decision === 'approve' ? input.approval.approveLabel : input.approval.denyLabel },
    })) },
  ] }
  await host.activate({ activate(context) {
    context.channels.registerFormatter(input.channelId, request => {
      assert.deepEqual(request, input)
      return result
    })
  } })
  assert.deepEqual(await host.formatChannelReply(input), result)
  await host.deactivate()
})
