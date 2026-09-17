import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { build } from 'esbuild'
import JSZip from 'jszip'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'
import { createTestHost } from '../packages/test-host/dist/index.js'

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')
const packageRoot = join(root, 'packages/discord')

// ---- shared bundling helpers ---------------------------------------------------------------

let bundleDirectory
async function bundleModule(relativeSourcePath) {
  bundleDirectory ??= await mkdtemp(join(tmpdir(), 'saycode-discord-unit-'))
  const outfile = join(bundleDirectory, `${relativeSourcePath.replace(/\W+/g, '-')}-${Date.now()}-${Math.random()}.mjs`)
  await build({
    entryPoints: [join(packageRoot, relativeSourcePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    outfile,
    external: ['@buzzni/saycode-extension-sdk'],
  })
  return import(pathToFileURL(outfile).href)
}

async function packedDiscord() {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-discord-'))
  const archivePath = join(temporary, 'discord.saycode-extension')
  await exec('node', [cli, 'pack', packageRoot, '--output', archivePath])
  const zip = await JSZip.loadAsync(await readFile(archivePath))
  const modulePath = join(temporary, 'index.mjs')
  await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
  const extension = (await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)).default
  return { temporary, zip, extension }
}

function envelope(overrides) {
  return {
    eventHandle: 'handle-1',
    connectionRevision: 1,
    semanticMessageId: 'msg-1',
    text: 'hello',
    sender: { bot: false },
    ...overrides,
  }
}

// ---- manifest --------------------------------------------------------------------------------

test('Discord manifest declares exactly the channel it uses and nothing wider', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8')),
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 },
  )
  assert.equal(manifest.id, 'buzzni.discord')
  assert.equal(manifest.channelApiVersion, 1)
  assert.deepEqual(manifest.permissions, ['channels.receive', 'channels.ack', 'channels.send', 'sessions.control', 'sessions.approveOnce'])
  assert.deepEqual(manifest.activationEvents, ['onChannel:buzzni.discord.bot'])
  assert.equal(manifest.contributes.channels.length, 1)
  assert.equal(manifest.contributes.channels[0].id, 'buzzni.discord.bot')
  assert.equal(manifest.contributes.channels[0].provider, 'discord')
})

test('Discord declares exactly the seven P3 Application Commands, each with the exact contracted options', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8')),
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 },
  )
  const commands = manifest.contributes.channels[0].commands
  assert.deepEqual(commands.map((command) => command.id).sort(), ['new', 'pair', 'projects', 'prompt', 'status', 'stop', 'use'])
  const byId = Object.fromEntries(commands.map((command) => [command.id, command]))
  assert.deepEqual(byId.new.options.map((option) => option.name), ['project', 'agent', 'model', 'effort'])
  assert.equal(byId.new.options[0].required, true)
  assert.equal(byId.new.options[1].required, false)
  assert.deepEqual(byId.use.options, [{ name: 'session_id', description: 'Session id', required: true }])
  assert.deepEqual(byId.prompt.options, [{ name: 'text', description: 'Prompt text', required: true }])
  // Regression: `pair` originally shipped with zero options, leaving a Discord user nowhere to
  // type the pairing code — root caught this in review.
  assert.deepEqual(byId.pair.options, [{ name: 'code', description: 'Pairing code', required: true }])
  assert.equal(byId.projects.options, undefined)
  assert.equal(byId.status.options, undefined)
  assert.equal(byId.stop.options, undefined)
})

test('Discord never actually calls channels.send despite declaring it', async () => {
  const source = await readFile(join(packageRoot, 'src/intakeLoop.ts'), 'utf8')
  const indexSource = await readFile(join(packageRoot, 'src/index.ts'), 'utf8')
  assert.doesNotMatch(source, /'channels\.send'/)
  assert.doesNotMatch(indexSource, /'channels\.send'/)
})

test('Discord packs as an installable API v3 archive', async () => {
  const packed = await packedDiscord()
  try {
    assert.deepEqual(Object.keys(packed.zip.files).sort(), ['extension.json', 'index.js'])
    const manifest = JSON.parse(await packed.zip.file('extension.json').async('string'))
    assert.equal(
      parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 }).id,
      'buzzni.discord',
    )
    assert.ok(typeof packed.extension.activate === 'function')
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

// ---- command parsing / mention normalization (white-box: pure functions) ----------------------

test('Discord command text maps to the exact sessions.control operations Core parses', async () => {
  const { parseDiscordCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(parseDiscordCommand('/projects'), { operation: 'projects' })
  assert.deepEqual(parseDiscordCommand('/status'), { operation: 'status' })
  assert.deepEqual(parseDiscordCommand('/stop'), { operation: 'stop' })
  assert.deepEqual(parseDiscordCommand('/new build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseDiscordCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseDiscordCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseDiscordCommand('/select'), { operation: 'prompt', text: '/select' })
  assert.deepEqual(parseDiscordCommand('/unknowncmd foo'), { operation: 'prompt', text: '/unknowncmd foo' })
  assert.deepEqual(parseDiscordCommand('그냥 대화 내용입니다'), { operation: 'prompt', text: '그냥 대화 내용입니다' })
})

test('/use and /start are recognized as Core\'s own aliases for select and new (classifyChannelIntent COMMAND_INTENTS)', async () => {
  const { parseDiscordCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(parseDiscordCommand('/start build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseDiscordCommand('/use sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseDiscordCommand('/start'), { operation: 'create' })
  // Empty /use falls back to prompt, same rule as empty /select.
  assert.deepEqual(parseDiscordCommand('/use'), { operation: 'prompt', text: '/use' })
  // Existing canonical words are unaffected by adding the aliases.
  assert.deepEqual(parseDiscordCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseDiscordCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
})

test('a mention naming someone else is never treated as a command trigger (no unverified stripping)', async () => {
  const { parseDiscordCommand } = await bundleModule('src/commands.ts')
  // Without a Core-verified bot user id, this adapter cannot tell "the bot was @mentioned" from
  // "someone else was mentioned" — a leading mention must never be stripped before matching the
  // slash-command pattern, or a message that only *mentions* another user could execute `/stop`.
  assert.deepEqual(parseDiscordCommand('<@999999999999999999> /stop'), { operation: 'prompt', text: '@999999999999999999 /stop' })
  assert.deepEqual(parseDiscordCommand('<@!999999999999999999> /new landing page'), { operation: 'prompt', text: '@999999999999999999 /new landing page' })
  assert.deepEqual(parseDiscordCommand('<@999999999999999999> hello there'), { operation: 'prompt', text: '@999999999999999999 hello there' })
})

test('Discord mention/channel/role/emoji markup resolves to plain text in prompt content', async () => {
  const { normalizeDiscordText } = await bundleModule('src/commands.ts')
  assert.equal(normalizeDiscordText('ping <@123>'), 'ping @123')
  assert.equal(normalizeDiscordText('ping <@!123>'), 'ping @123')
  assert.equal(normalizeDiscordText('role <@&456>'), 'role @&456')
  assert.equal(normalizeDiscordText('see <#789>'), 'see #789')
  assert.equal(normalizeDiscordText('nice <:wave:111>'), 'nice :wave:')
  assert.equal(normalizeDiscordText('nice <a:wave:111>'), 'nice :wave:')
})

// ---- structured Application Command mapping (white-box: pure function, no re-tokenizing) -------

test('mapDiscordStructuredCommand maps each of the seven declared commands without re-tokenizing text', async () => {
  const { mapDiscordStructuredCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'new', args: { project: 'my project', agent: 'x' } }), { operation: 'create' })
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'use', args: { session_id: 'sess-42' } }), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'prompt', args: { text: 'continue please' } }), { operation: 'prompt', text: 'continue please' })
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'projects', args: {} }), { operation: 'projects' })
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'status', args: {} }), { operation: 'status' })
  assert.deepEqual(mapDiscordStructuredCommand({ name: 'stop', args: {} }), { operation: 'stop' })
})

test('mapDiscordStructuredCommand never forwards new\'s project/agent/model/effort onto the wire (Core derives them from its own event record)', async () => {
  const { mapDiscordStructuredCommand } = await bundleModule('src/commands.ts')
  const proposal = mapDiscordStructuredCommand({ name: 'new', args: { project: 'x', agent: 'y', model: 'z', effort: 'high' } })
  assert.deepEqual(Object.keys(proposal).sort(), ['operation'])
})

test('mapDiscordStructuredCommand refuses pair — it is Core\'s own concern and must never become a prompt', async () => {
  const { mapDiscordStructuredCommand } = await bundleModule('src/commands.ts')
  assert.equal(mapDiscordStructuredCommand({ name: 'pair', args: { code: 'abc12345' } }), null)
})

test('mapDiscordStructuredCommand refuses use/prompt when the required argument is unexpectedly missing, rather than guessing', async () => {
  const { mapDiscordStructuredCommand } = await bundleModule('src/commands.ts')
  assert.equal(mapDiscordStructuredCommand({ name: 'use', args: {} }), null)
  assert.equal(mapDiscordStructuredCommand({ name: 'prompt', args: {} }), null)
})

// ---- backoff (white-box: pure function) --------------------------------------------------------

test('receive backoff resets on events and is bounded when idle', async () => {
  const { nextDiscordReceiveDelayMs, DISCORD_RECEIVE_BASE_MS, DISCORD_RECEIVE_MAX_MS } = await bundleModule('src/backoff.ts')
  let delay = DISCORD_RECEIVE_BASE_MS
  for (let i = 0; i < 10; i++) delay = nextDiscordReceiveDelayMs(delay, false)
  assert.equal(delay, DISCORD_RECEIVE_MAX_MS)
  assert.equal(nextDiscordReceiveDelayMs(delay, true), DISCORD_RECEIVE_BASE_MS)
})

// ---- formatter (white-box: pure function, also exercised through the real formatter registration) --

test('formatter concatenates back to the exact input for Korean and emoji text', async () => {
  const { formatDiscordReply } = await bundleModule('src/reply.ts')
  const text = '안녕하세요! 🎉🚀 결과가 도착했습니다. '.repeat(30) + '😀'.repeat(5)
  const { chunks } = formatDiscordReply({ text, maxChunkUtf16Units: 40, maxChunks: 200 })
  assert.equal(chunks.join(''), text)
  for (const chunk of chunks) assert.ok(chunk.length <= 40 + 1)
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) assert.ok(i + 1 < chunk.length && chunk.charCodeAt(i + 1) >= 0xdc00 && chunk.charCodeAt(i + 1) <= 0xdfff)
      if (code >= 0xdc00 && code <= 0xdfff) assert.ok(i > 0 && chunk.charCodeAt(i - 1) >= 0xd800 && chunk.charCodeAt(i - 1) <= 0xdbff)
    }
  }
})

test('formatter never splits a surrogate pair even at a 1-unit cap', async () => {
  const { formatDiscordReply } = await bundleModule('src/reply.ts')
  const { chunks } = formatDiscordReply({ text: '😀😀', maxChunkUtf16Units: 1, maxChunks: 10 })
  assert.deepEqual(chunks, ['😀', '😀'])
  assert.equal(chunks.join(''), '😀😀')
})

test('formatter returns no chunks for empty text and adds no markers of its own', async () => {
  const { formatDiscordReply } = await bundleModule('src/reply.ts')
  assert.deepEqual(formatDiscordReply({ text: '', maxChunkUtf16Units: 10, maxChunks: 5 }).chunks, [])
  const { chunks } = formatDiscordReply({ text: 'exact-forty-char-one-chunk-of-text-here', maxChunkUtf16Units: 40, maxChunks: 5 })
  assert.deepEqual(chunks, ['exact-forty-char-one-chunk-of-text-here'])
})

test('formatter refuses to silently drop text that cannot fit the chunk budget', async () => {
  const { formatDiscordReply, DiscordReplyFormatError } = await bundleModule('src/reply.ts')
  assert.throws(
    () => formatDiscordReply({ text: 'x'.repeat(100), maxChunkUtf16Units: 10, maxChunks: 5 }),
    DiscordReplyFormatError,
  )
})

// ---- approval formatter (white-box: pure function) ----------------------------------------------

function approvalRequest(overrides) {
  return {
    text: 'Allow this action?',
    maxChunkUtf16Units: 4096,
    maxChunks: 8,
    approval: { approvalHandle: 'appr-1', approveLabel: 'Approve', denyLabel: 'Deny' },
    ...overrides,
  }
}

test('approval renders exactly one chunk plus a single action row of two buttons, both custom_ids carrying the exact Core handle', async () => {
  const { formatDiscordApproval } = await bundleModule('src/approval.ts')
  const result = formatDiscordApproval(approvalRequest())
  assert.deepEqual(result.chunks, ['Allow this action?'])
  assert.equal(result.blocks, undefined)
  assert.deepEqual(result.components, [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: 'Approve', custom_id: 'saycode:approve:appr-1' },
        { type: 2, style: 4, label: 'Deny', custom_id: 'saycode:deny:appr-1' },
      ],
    },
  ])
})

test('approval rejects a missing or empty approvalHandle/label/text', async () => {
  const { formatDiscordApproval, DiscordApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(() => formatDiscordApproval(approvalRequest({ text: '' })), DiscordApprovalFormatError)
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ approval: { approvalHandle: '', approveLabel: 'Approve', denyLabel: 'Deny' } })),
    DiscordApprovalFormatError,
  )
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: '', denyLabel: 'Deny' } })),
    DiscordApprovalFormatError,
  )
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: 'Approve', denyLabel: '' } })),
    DiscordApprovalFormatError,
  )
})

test('approval rejects an oversized approvalHandle or label', async () => {
  const { formatDiscordApproval, DiscordApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ approval: { approvalHandle: 'x'.repeat(81), approveLabel: 'Approve', denyLabel: 'Deny' } })),
    DiscordApprovalFormatError,
  )
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: 'x'.repeat(76), denyLabel: 'Deny' } })),
    DiscordApprovalFormatError,
  )
})

test('approval rejects text that cannot fit in the single chunk the result type allows', async () => {
  const { formatDiscordApproval, DiscordApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ text: 'x'.repeat(50), maxChunkUtf16Units: 10 })),
    DiscordApprovalFormatError,
  )
})

test('approval rejects text over Discord\'s own 2000-char content cap even when the caller\'s chunk budget is far more permissive', async () => {
  const { formatDiscordApproval, DiscordApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatDiscordApproval(approvalRequest({ text: 'x'.repeat(2001), maxChunkUtf16Units: 65536 })),
    DiscordApprovalFormatError,
  )
  // Exactly at the platform cap still succeeds.
  const result = formatDiscordApproval(approvalRequest({ text: 'x'.repeat(2000), maxChunkUtf16Units: 65536 }))
  assert.equal(result.chunks[0].length, 2000)
})

// ---- intake runtime: activation lifecycle / command flow / duplicates / stop-in-flight ---------

function fakeCapabilities(receivePages, { onControl, controlDelay, onApproveOnce, approveOnceDelay } = {}) {
  const calls = []
  let receiveIndex = 0
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, action, args })
    if (permission === 'channels.receive') {
      const page = receivePages[Math.min(receiveIndex, receivePages.length - 1)]
      receiveIndex += 1
      return page
    }
    if (permission === 'sessions.control') {
      if (controlDelay) await controlDelay(args)
      return onControl?.(args) ?? { requestId: 'req', state: 'accepted' }
    }
    if (permission === 'sessions.approveOnce') {
      if (approveOnceDelay) await approveOnceDelay(args)
      return onApproveOnce?.(args) ?? { outcome: 'applied', status: 'The decision was applied.' }
    }
    if (permission === 'channels.ack') return { cursor: args.cursor }
    throw new Error(`unexpected capability: ${permission}`)
  }
  return { invokeCapability, calls }
}

test('activation lifecycle drives receive -> dispatch -> ack for each command', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/projects' }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/new landing page' }),
      envelope({ eventHandle: 'h3', semanticMessageId: 'm3', text: '/select sess-9' }),
      envelope({ eventHandle: 'h4', semanticMessageId: 'm4', text: '/status' }),
      envelope({ eventHandle: 'h5', semanticMessageId: 'm5', text: '/stop' }),
      envelope({ eventHandle: 'h6', semanticMessageId: 'm6', text: '자유 프롬프트 😀' }),
    ],
    cursor: '6',
  }
  const emptyPage = { events: [], cursor: '6' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => ({ eventHandle: call.args.eventHandle, operation: call.args.operation, sessionRef: call.args.sessionRef, text: call.args.text })), [
    { eventHandle: 'h1', operation: 'projects', sessionRef: undefined, text: undefined },
    { eventHandle: 'h2', operation: 'create', sessionRef: undefined, text: 'landing page' },
    { eventHandle: 'h3', operation: 'select', sessionRef: 'sess-9', text: undefined },
    { eventHandle: 'h4', operation: 'status', sessionRef: undefined, text: undefined },
    { eventHandle: 'h5', operation: 'stop', sessionRef: undefined, text: undefined },
    { eventHandle: 'h6', operation: 'prompt', sessionRef: undefined, text: '자유 프롬프트 😀' },
  ])
  const ids = controlCalls.map((call) => call.args.clientRequestId)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))

  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '6')
  assert.ok(calls.indexOf(ackCalls[0]) > calls.lastIndexOf(controlCalls.at(-1)))
})

test('a message Discord marks bot-authored is dropped, not dispatched, but still acked (R11)', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'echo', sender: { bot: true } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status', sender: { bot: false } }),
    ],
    cursor: '2',
  }
  const emptyPage = { events: [], cursor: '2' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h2'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '2')
})

test('an envelope with a missing or malformed sender.bot flag fails closed: dropped and acked, never dispatched', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'echo', sender: undefined }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: 'echo', sender: {} }),
      envelope({ eventHandle: 'h3', semanticMessageId: 'm3', text: 'echo', sender: { bot: 'no' } }),
      envelope({ eventHandle: 'h4', semanticMessageId: 'm4', text: '/status', sender: { bot: false } }),
    ],
    cursor: '4',
  }
  const emptyPage = { events: [], cursor: '4' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h4'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '4')
})

// ---- structured Application Command intake: takes priority over text, never re-tokenizes -------

test('an envelope carrying Core\'s normalized Application Command dispatches via the structured path, not parseDiscordCommand', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'ignored raw content', command: { name: 'new', args: { project: 'x --agent evil' } } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: 'ignored', command: { name: 'use', args: { session_id: 'sess-42' } } }),
      envelope({ eventHandle: 'h3', semanticMessageId: 'm3', text: 'ignored', command: { name: 'prompt', args: { text: 'continue please' } } }),
      envelope({ eventHandle: 'h4', semanticMessageId: 'm4', text: 'ignored', command: { name: 'projects', args: {} } }),
      envelope({ eventHandle: 'h5', semanticMessageId: 'm5', text: 'ignored', command: { name: 'status', args: {} } }),
      envelope({ eventHandle: 'h6', semanticMessageId: 'm6', text: 'ignored', command: { name: 'stop', args: {} } }),
    ],
    cursor: '6',
  }
  const emptyPage = { events: [], cursor: '6' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => ({ eventHandle: call.args.eventHandle, operation: call.args.operation, sessionRef: call.args.sessionRef, text: call.args.text })), [
    { eventHandle: 'h1', operation: 'create', sessionRef: undefined, text: undefined },
    { eventHandle: 'h2', operation: 'select', sessionRef: 'sess-42', text: undefined },
    { eventHandle: 'h3', operation: 'prompt', sessionRef: undefined, text: 'continue please' },
    { eventHandle: 'h4', operation: 'projects', sessionRef: undefined, text: undefined },
    { eventHandle: 'h5', operation: 'status', sessionRef: undefined, text: undefined },
    { eventHandle: 'h6', operation: 'stop', sessionRef: undefined, text: undefined },
  ])
  // h1's `new` never carries project/agent/model/effort on the wire, and the hostile-looking
  // `project` value never got re-tokenized into a fake `--agent` flag — there is nothing to
  // re-tokenize because no text derived from it ever reached `invokeCapability`.
  assert.equal(controlCalls[0].args.text, undefined)
})

test('a pair command reaching the adapter is refused, not dispatched as sessions.control and never as a prompt', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/pair abc12345', command: { name: 'pair', args: { code: 'abc12345' } } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status' }),
    ],
    cursor: '2',
  }
  const emptyPage = { events: [], cursor: '2' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  // Only h2 dispatches; h1 (pair) is dropped entirely — never as sessions.control, and specifically
  // never as `operation: 'prompt'` (which would have leaked the pairing code into a session).
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h2'])
  assert.ok(!controlCalls.some((call) => call.args.eventHandle === 'h1'))
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '2')
})

test('a structured command missing its required argument is dropped rather than guessed', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'ignored', command: { name: 'use', args: {} } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status' }),
    ],
    cursor: '2',
  }
  const emptyPage = { events: [], cursor: '2' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h2'])
})

test('existing text-DM dispatch is unaffected when no structured command is present (back-compat)', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = { events: [envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/new my project' })], cursor: '1' }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => ({ operation: call.args.operation, text: call.args.text })), [
    { operation: 'create', text: 'my project' },
  ])
})

test('an envelope carrying Core\'s validated action invokes sessions.approveOnce, not sessions.control', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({
        eventHandle: 'h1', semanticMessageId: 'm1', text: 'ignored',
        action: { approvalHandle: 'appr-1', decision: 'approve' },
      }),
    ],
    cursor: '1',
  }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 0)
  const approveCalls = calls.filter((call) => call.permission === 'sessions.approveOnce')
  assert.equal(approveCalls.length, 1)
  assert.deepEqual(approveCalls[0].args, {
    apiVersion: 1, eventHandle: 'h1', approvalHandle: 'appr-1', decision: 'approve',
  })
  assert.deepEqual(Object.keys(approveCalls[0].args).sort(), ['apiVersion', 'approvalHandle', 'decision', 'eventHandle'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
})

test('text that merely looks like an approval custom_id is never treated as proof — only the envelope\'s own action field routes to approveOnce', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      // No `action` field: an ordinary message whose *text* happens to contain the exact string
      // Core would have embedded in a real button's custom_id. If this adapter ever started
      // pattern-matching `text` for that shape, this event would be misrouted to approveOnce.
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'saycode:approve:appr-1' }),
    ],
    cursor: '1',
  }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.approveOnce').length, 0)
  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.equal(controlCalls.length, 1)
  assert.equal(controlCalls[0].args.operation, 'prompt')
  assert.equal(controlCalls[0].args.text, 'saycode:approve:appr-1')
})

test('stop mid-batch on an action envelope leaves it unacknowledged, same fencing as a command dispatch', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', action: { approvalHandle: 'appr-1', decision: 'deny' } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status' }),
    ],
    cursor: '2',
  }
  let stopPromise
  const { invokeCapability, calls } = fakeCapabilities([page1], {
    approveOnceDelay: async () => {
      stopPromise = runtime.stop()
      await new Promise((resolve) => setTimeout(resolve, 10))
    },
  })

  const runtime = createDiscordIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await stopPromise

  const approveCalls = calls.filter((call) => call.permission === 'sessions.approveOnce')
  assert.deepEqual(approveCalls.map((call) => call.args.eventHandle), ['h1'])
  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 0)
  assert.equal(calls.filter((call) => call.permission === 'channels.ack').length, 0)
})

test('the default request-id minter works when crypto.randomUUID is absent (Desktop\'s data: URL host document is not a secure context)', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const originalRandomUUID = crypto.randomUUID
  delete crypto.randomUUID
  try {
    const page1 = { events: [envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })], cursor: '1' }
    const emptyPage = { events: [], cursor: '1' }
    const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

    let stopped
    const stoppedSignal = new Promise((resolve) => { stopped = resolve })
    const runtime = createDiscordIntakeRuntime({
      invokeCapability,
      connectionId: 'conn-1',
      sleep: async () => { stopped() },
    })
    runtime.start()
    await stoppedSignal
    await runtime.stop()

    const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
    assert.equal(controlCalls.length, 1)
    const id = controlCalls[0].args.clientRequestId
    assert.equal(typeof id, 'string')
    assert.ok(id.length > 0)
  } finally {
    crypto.randomUUID = originalRandomUUID
  }
})

test('the same message is never dispatched twice even if Core re-offers it', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const repeated = envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })
  const page1 = { events: [repeated], cursor: '1' }
  const page2 = { events: [repeated], cursor: '1' }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, page2, emptyPage])

  let iterations = 0
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { iterations += 1; await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  while (iterations < 4) await new Promise((resolve) => setImmediate(resolve))
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 1)
})

test('stop mid-batch leaves the batch unacknowledged and dispatches nothing after it', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/projects' }),
    ],
    cursor: '2',
  }
  let stopPromise
  const { invokeCapability, calls } = fakeCapabilities([page1], {
    controlDelay: async (args) => {
      if (args.eventHandle === 'h1') {
        stopPromise = runtime.stop()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
  })

  const runtime = createDiscordIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await stopPromise

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h1'])
  assert.equal(calls.filter((call) => call.permission === 'channels.ack').length, 0)
})

test('a receive failure backs off and does not ack, then recovers on the next window', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  let receiveCall = 0
  const errors = []
  const calls = []
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, args })
    if (permission === 'channels.receive') {
      receiveCall += 1
      if (receiveCall === 1) throw new Error('transient network error')
      return { events: [envelope({ text: '/status' })], cursor: '1' }
    }
    if (permission === 'sessions.control') return {}
    if (permission === 'channels.ack') return { cursor: args.cursor }
    throw new Error('unexpected')
  }

  let iterations = 0
  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    onError: (error) => errors.push(error),
    sleep: async () => { iterations += 1; await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  while (iterations < 3) await new Promise((resolve) => setImmediate(resolve))
  await runtime.stop()

  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /transient network error/)
  assert.ok(calls.some((call) => call.permission === 'sessions.control'))
  assert.ok(calls.some((call) => call.permission === 'channels.ack'))
})

test('stop settles immediately even while idle backoff is parked at its 30s cap', async (t) => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const { DISCORD_RECEIVE_MAX_MS } = await bundleModule('src/backoff.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const invokeCapability = async (permission) => {
    if (permission === 'channels.receive') return { events: [], cursor: null }
    return {}
  }
  const runtime = createDiscordIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()

  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(DISCORD_RECEIVE_MAX_MS)
    await new Promise((resolve) => setImmediate(resolve))
  }

  const settledWithoutTicking = await Promise.race([
    runtime.stop().then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ])
  assert.equal(settledWithoutTicking, true)
})

test('a stale generation from a repeated start is discarded and stop waits for it too', async () => {
  const { createDiscordIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const calls = []
  let releaseStaleReceive
  const staleReceiveGate = new Promise((resolve) => { releaseStaleReceive = resolve })
  let receiveCount = 0
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, args })
    if (permission === 'channels.receive') {
      receiveCount += 1
      if (receiveCount === 1) {
        await staleReceiveGate
        return { events: [envelope({ eventHandle: 'stale', semanticMessageId: 'stale-msg' })], cursor: '1' }
      }
      return { events: [], cursor: null }
    }
    return {}
  }

  const runtime = createDiscordIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  runtime.start()

  releaseStaleReceive()
  await runtime.stop()

  assert.ok(!calls.some((call) => call.permission === 'sessions.control' && call.args.eventHandle === 'stale'))
  const callCountAtStop = calls.length
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, callCountAtStop)
})

// ---- real activation wiring through the packed artifact + SDK test host -----------------------

test('the packaged extension wires channels.receive polling and the formatter through the real host', async () => {
  const packed = await packedDiscord()
  try {
    const calls = []
    let firstReceiveSeen
    const firstReceive = new Promise((resolve) => { firstReceiveSeen = resolve })
    const host = createTestHost('buzzni.discord', {
      async invokeCapability(permission, action, args) {
        calls.push({ permission, action, args })
        if (permission === 'channels.receive') {
          firstReceiveSeen()
          return { events: [], cursor: null }
        }
        if (permission === 'channels.ack') return { cursor: args.cursor }
        return {}
      },
    })
    await host.activate(packed.extension)

    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.discord.bot',
      state: 'start',
      connectionId: 'conn-real',
      provider: 'discord',
      connectionRevision: 1,
    })
    await firstReceive
    assert.ok(calls.some((call) => call.permission === 'channels.receive' && call.args.connectionId === 'conn-real'))

    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.discord.bot',
      state: 'stop',
      connectionId: 'conn-real',
      provider: 'discord',
      connectionRevision: 1,
    })

    const formatted = await host.formatChannelReply({
      apiVersion: 1,
      channelId: 'buzzni.discord.bot',
      connectionId: 'conn-real',
      provider: 'discord',
      connectionRevision: 1,
      requestId: 'req-1',
      kind: 'final',
      text: '결과: 완료 🎉',
      maxChunkUtf16Units: 4096,
      maxChunks: 8,
    })
    assert.deepEqual(formatted.chunks, ['결과: 완료 🎉'])

    const formattedApproval = await host.formatChannelReply({
      apiVersion: 1,
      channelId: 'buzzni.discord.bot',
      connectionId: 'conn-real',
      provider: 'discord',
      connectionRevision: 1,
      requestId: 'req-2',
      kind: 'approval',
      text: 'Allow this action?',
      maxChunkUtf16Units: 4096,
      maxChunks: 8,
      approval: { approvalHandle: 'appr-real-1', approveLabel: 'Approve', denyLabel: 'Deny' },
    })
    assert.deepEqual(formattedApproval.chunks, ['Allow this action?'])
    assert.equal(formattedApproval.components[0].components[0].custom_id, 'saycode:approve:appr-real-1')
    assert.equal(formattedApproval.components[0].components[1].custom_id, 'saycode:deny:appr-real-1')

    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('a stop for a connection this host never started is a no-op', async () => {
  const packed = await packedDiscord()
  try {
    const host = createTestHost('buzzni.discord', {
      async invokeCapability() { return { events: [], cursor: null } },
    })
    await host.activate(packed.extension)
    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.discord.bot',
      state: 'stop',
      connectionId: 'conn-never-started',
      provider: 'discord',
      connectionRevision: 1,
    })
    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})
