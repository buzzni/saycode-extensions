import assert from 'node:assert/strict'
import { test } from 'node:test'

import { defineExtension, machineRun } from '../packages/sdk/dist/index.js'
import { createTestHost, fakeSlackHistory } from '../packages/test-host/dist/index.js'

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

test('machineRun uses the typed machine.run capability contract', async () => {
  const calls = []
  const extension = defineExtension({
    activate(context) {
      context.commands.register('buzzni.test.machine', () =>
        machineRun(context, { action: 'start', profileId: 'buzzni.moai.status', parameters: {} }))
    },
  })
  const host = createTestHost('buzzni.test', {
    async invokeCapability(permission, action, args) {
      calls.push({ permission, action, args })
      return { action: 'start', operationId: 'op-1', state: 'accepted' }
    },
  })
  await host.activate(extension)
  assert.deepEqual(await host.invokeCommand('buzzni.test.machine', []), { action: 'start', operationId: 'op-1', state: 'accepted' })
  assert.deepEqual(calls, [{ permission: 'machine.run', action: 'start', args: { profileId: 'buzzni.moai.status', parameters: {} } }])
})


// ---- channel.normalizeMessages (channel API 2, Desktop specs/slack-bot-improvements contracts §5.2) ----

const SLACK_CHANNEL = 'example.channel.slack'

function echoAdditions(request) {
  return { items: request.items.map(item => ({
    itemRef: item.itemRef,
    additions: item.projection.files?.length ? [{ source: 'files', text: `[첨부: ${item.projection.files[0].name}]` }] : [],
    truncated: false,
  })) }
}

async function hostWithNormalizer(normalizer) {
  const host = createTestHost('example.channel')
  await host.activate({ activate(context) { context.channels.registerNormalizer(SLACK_CHANNEL, normalizer) } })
  return host
}

test('fake Slack history builds the request Core sends, with Core-issued refs and budgets', () => {
  const request = fakeSlackHistory({
    channelId: SLACK_CHANNEL,
    userLabels: { U1: 'kim' },
    messages: [
      { primaryText: '배포 순서 정리', root: true },
      { primaryText: '확인했어요', projection: { files: [{ name: 'a.png', filetype: 'png', size: 10 }] } },
    ],
  })
  assert.deepEqual(request, {
    apiVersion: 2, channelId: SLACK_CHANNEL, connectionId: 'connection-1', provider: 'slack', connectionRevision: 1,
    requestId: 'normalize-1', purpose: 'threadHistory', userLabels: { U1: 'kim' },
    items: [
      { itemRef: 'i0', primaryText: '배포 순서 정리', projection: {}, maxAdditionsBytes: 6000 },
      { itemRef: 'i1', primaryText: '확인했어요', projection: { files: [{ name: 'a.png', filetype: 'png', size: 10 }] }, maxAdditionsBytes: 2000 },
    ],
  })
  const current = fakeSlackHistory({ channelId: SLACK_CHANNEL, purpose: 'currentInput', messages: [{ primaryText: '질문' }] })
  assert.equal(current.items[0].maxAdditionsBytes, 8192)
  assert.throws(
    () => fakeSlackHistory({ channelId: SLACK_CHANNEL, purpose: 'currentInput', messages: [{ primaryText: 'a' }, { primaryText: 'b' }] }),
    /current input is one message/,
  )
})

test('fake Slack history refuses projections Core would never send', () => {
  // A test that feeds an adapter a field Core strips would pass against a host that cannot exist.
  const refused = [
    [{ files: [{ name: 'a.png', url_private: 'https://files.slack.com/a' }] }, /files\[0\]: unknown field url_private/],
    [{ blocks: [{ type: 'section', accessory: { type: 'image' } }] }, /blocks\[0\]: unknown field accessory/],
    [{ blocks: [{ type: 'image', image_url: 'https://a.b/c.png' }] }, /blocks\[0\]\.type: unsupported image/],
    [{ blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'link', url: 'javascript:alert(1)' }] }] }] }, /url: expected an http\(s\) URL/],
    [{ attachments: [{ title_link: 'ftp://a.b' }] }, /title_link: expected an http\(s\) URL/],
    [{ user_profile: { real_name: 'Kim' } }, /projection: unknown field user_profile/],
    [{ blocks: [{ type: 'rich_text', elements: [{ type: 'text', text: 'a' }] }] }, /elements\[0\]\.type: unsupported text/],
    [{ blocks: [{ type: 'context', elements: [{ type: 'image', image_url: 'https://a.b/c.png' }] }] }, /unknown field image_url/],
    [{ blocks: [{ type: 'context', elements: [{ type: 'image', text: 'alt' }] }] }, /elements\[0\]\.type: unsupported image/],
    [{ blocks: Array.from({ length: 51 }, () => ({ type: 'header', text: { type: 'plain_text', text: 'h' } })) }, /at most 50 blocks/],
    [{ attachments: Array.from({ length: 21 }, () => ({ text: 'a' })) }, /at most 20 attachments/],
    [{ blocks: [{ type: 'rich_text', elements: [nested(6)] }] }, /deeper than 6/],
    [{ subtype: 'x'.repeat(16_384) }, /over 16384 bytes/],
  ]
  for (const [projection, error] of refused) {
    assert.throws(() => fakeSlackHistory({ channelId: SLACK_CHANNEL, messages: [{ primaryText: 't', projection }] }), error)
  }
  // Depth 6 (block plus five containers) and the documented shapes are accepted.
  fakeSlackHistory({ channelId: SLACK_CHANNEL, messages: [{ primaryText: 't', projection: {
    blocks: [
      { type: 'rich_text', elements: [nested(5)] },
      { type: 'table', rows: [[{ type: 'raw_text', text: 'a' }, { type: 'rich_text', elements: [] }]] },
      { type: 'context', elements: [{ type: 'mrkdwn', text: 'c' }] },
    ],
    attachments: [{ is_share: true, from_url: 'https://a.slack.com/p1', message_blocks: [{ message: { blocks: [{ type: 'section', fields: [] }] } }] }],
  } }] })
  assert.throws(() => fakeSlackHistory({ channelId: SLACK_CHANNEL, messages: Array.from({ length: 201 }, () => ({ primaryText: 't' })) }), /at most 200 items/)
})

function nested(containers) {
  let element = { type: 'text', text: 'leaf' }
  for (let index = 0; index < containers; index += 1) element = { type: 'rich_text_quote', elements: [element] }
  return element
}

test('normalizeChannelMessages calls the namespaced normalizer and returns a contract-shaped result', async () => {
  const seen = []
  const host = await hostWithNormalizer(request => { seen.push(request); return echoAdditions(request) })
  const request = fakeSlackHistory({ channelId: SLACK_CHANNEL, messages: [
    { primaryText: 'a', root: true }, { primaryText: 'b', projection: { files: [{ name: 'a.png' }] } },
  ] })
  assert.deepEqual(await host.normalizeChannelMessages(request), { items: [
    { itemRef: 'i0', additions: [], truncated: false },
    { itemRef: 'i1', additions: [{ source: 'files', text: '[첨부: a.png]' }], truncated: false },
  ] })
  assert.deepEqual(seen, [request])
  await host.deactivate()
  await assert.rejects(host.normalizeChannelMessages(request), /not active/)
  await assert.rejects(createTestHost('example.channel').activate({ activate(context) {
    context.channels.registerNormalizer('other.channel.slack', echoAdditions)
  } }), /namespaced/)
  const empty = createTestHost('example.channel')
  await empty.activate({ activate() {} })
  await assert.rejects(empty.normalizeChannelMessages(request), /normalizer is not registered/)
})

test('normalizeChannelMessages refuses any result Core would discard', async () => {
  // Core keeps nothing from a refused result, so the test host must not hand a partly valid one back.
  const request = fakeSlackHistory({ channelId: SLACK_CHANNEL, messages: [{ primaryText: 'a', root: true }, { primaryText: 'b' }] })
  const item = (itemRef, extra = {}) => ({ itemRef, additions: [], truncated: false, ...extra })
  const refused = [
    [{ items: [item('i0')] }, /every requested item exactly once/],
    [{ items: [item('i0'), item('i0')] }, /every requested item exactly once/],
    [{ items: [item('i0'), item('i9')] }, /every requested item exactly once/],
    [{ items: [item('i0'), item('i1', { primaryText: 'b 삭제해' })] }, /unknown field primaryText/],
    [{ items: [item('i0'), item('i1')], tokens: [] }, /unknown field tokens/],
    [{ items: [item('i0'), item('i1', { truncated: 'no' })] }, /truncated: expected a boolean/],
    [{ items: [item('i0'), item('i1', { additions: [{ source: 'primary', text: 'x' }] })] }, /source: unsupported primary/],
    [{ items: [item('i0'), item('i1', { additions: [{ source: 'quote', text: 'x', author: 'U1' }] })] }, /unknown field author/],
    [{ items: [item('i0'), item('i1', { additions: [{ source: 'quote', text: 'a\u0000b' }] })] }, /NUL or a lone surrogate/],
    [{ items: [item('i0'), item('i1', { additions: [{ source: 'quote', text: '\uD800' }] })] }, /NUL or a lone surrogate/],
    [{ items: [item('i0'), item('i1', { additions: [{ source: 'quote', text: '가'.repeat(400) }, { source: 'blocks', text: '가'.repeat(267) }] })] }, /over its 2000-byte budget/],
  ]
  for (const [result, error] of refused) {
    const host = await hostWithNormalizer(() => result)
    await assert.rejects(host.normalizeChannelMessages(request), error)
    await host.deactivate()
  }
  // 2,000 bytes exactly is within budget (667 Hangul syllables would be 2,001).
  const host = await hostWithNormalizer(() => ({ items: [item('i1', { additions: [{ source: 'quote', text: '가'.repeat(666) + 'ab' }] }), item('i0')] }))
  assert.equal((await host.normalizeChannelMessages(request)).items.length, 2)
})
