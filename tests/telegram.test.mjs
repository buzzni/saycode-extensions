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
const packageRoot = join(root, 'packages/telegram')

// ---- shared bundling helpers ---------------------------------------------------------------
// The package has no tsc build step (esbuild strips its types at pack time, matching every other
// provider adapter in this repo); tests bundle the same way so they exercise the real TS source,
// not a hand-transcribed copy of its logic.

let bundleDirectory
async function bundleModule(relativeSourcePath) {
  bundleDirectory ??= await mkdtemp(join(tmpdir(), 'saycode-telegram-unit-'))
  const outfile = join(bundleDirectory, `${relativeSourcePath.replace(/\W+/g, '-')}-${Date.now()}-${Math.random()}.mjs`)
  await build({
    entryPoints: [join(packageRoot, relativeSourcePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    outfile,
    // The SDK's real types-only exports have no runtime module; only relative sources bundle.
    external: ['@buzzni/saycode-extension-sdk'],
  })
  return import(pathToFileURL(outfile).href)
}

async function packedTelegram() {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-telegram-'))
  const archivePath = join(temporary, 'telegram.saycode-extension')
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

test('Telegram manifest declares exactly the channel it uses and nothing wider', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8')),
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 },
  )
  assert.equal(manifest.id, 'buzzni.telegram')
  assert.equal(manifest.channelApiVersion, 1)
  // `channels.send` is declared but never invoked by this package's runtime code: Desktop's
  // `ExtensionHostManager.formatChannelReply` requires it before registering a formatter at all,
  // since reshaping Core's approved text for an outside package is that permission's authority.
  assert.deepEqual(manifest.permissions, ['channels.receive', 'channels.ack', 'channels.send', 'sessions.control'])
  assert.deepEqual(manifest.activationEvents, ['onChannel:buzzni.telegram.bot'])
  assert.deepEqual(manifest.contributes.channels, [{ id: 'buzzni.telegram.bot', provider: 'telegram' }])
})

test('Telegram never actually calls channels.send despite declaring it', async () => {
  const source = await readFile(join(packageRoot, 'src/pollLoop.ts'), 'utf8')
  const indexSource = await readFile(join(packageRoot, 'src/index.ts'), 'utf8')
  assert.doesNotMatch(source, /'channels\.send'/)
  assert.doesNotMatch(indexSource, /'channels\.send'/)
})

test('Telegram packs as an installable API v3 archive', async () => {
  const packed = await packedTelegram()
  try {
    assert.deepEqual(Object.keys(packed.zip.files).sort(), ['extension.json', 'index.js'])
    const manifest = JSON.parse(await packed.zip.file('extension.json').async('string'))
    assert.equal(
      parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 }).id,
      'buzzni.telegram',
    )
    assert.ok(typeof packed.extension.activate === 'function')
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

// ---- command parsing (white-box: pure function) -----------------------------------------------

test('Telegram command text maps to the exact sessions.control operations Core parses', async () => {
  const { parseTelegramCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(parseTelegramCommand('/projects'), { operation: 'projects' })
  assert.deepEqual(parseTelegramCommand('/status'), { operation: 'status' })
  assert.deepEqual(parseTelegramCommand('/stop'), { operation: 'stop' })
  assert.deepEqual(parseTelegramCommand('/new build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseTelegramCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseTelegramCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseTelegramCommand('/select'), { operation: 'prompt', text: '/select' })
  assert.deepEqual(parseTelegramCommand('/select@my_bot sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseTelegramCommand('/unknowncmd foo'), { operation: 'prompt', text: '/unknowncmd foo' })
  assert.deepEqual(parseTelegramCommand('그냥 대화 내용입니다'), { operation: 'prompt', text: '그냥 대화 내용입니다' })
})

test('/use and /start are recognized as Core\'s own aliases for select and new (classifyChannelIntent COMMAND_INTENTS)', async () => {
  const { parseTelegramCommand } = await bundleModule('src/commands.ts')
  // With args: identical result shape to the canonical word.
  assert.deepEqual(parseTelegramCommand('/start build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseTelegramCommand('/use sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  // No args: /start behaves exactly like bare /new.
  assert.deepEqual(parseTelegramCommand('/start'), { operation: 'create' })
  // Empty /use falls back to prompt, same rule as empty /select (Core requires sessionRef when
  // the operation is select; sending an empty one would be worse than just forwarding the text).
  assert.deepEqual(parseTelegramCommand('/use'), { operation: 'prompt', text: '/use' })
  // Telegram's `@botname` suffix strips the same way for the aliases as for the canonical words.
  assert.deepEqual(parseTelegramCommand('/use@my_bot sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseTelegramCommand('/start@my_bot build a landing page'), { operation: 'create', text: 'build a landing page' })
  // Existing canonical words are unaffected by adding the aliases.
  assert.deepEqual(parseTelegramCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseTelegramCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
})

// ---- backoff (white-box: pure function) --------------------------------------------------------

test('poll backoff resets on events and is bounded when idle', async () => {
  const { nextTelegramPollDelayMs, TELEGRAM_POLL_BASE_MS, TELEGRAM_POLL_MAX_MS } = await bundleModule('src/backoff.ts')
  let delay = TELEGRAM_POLL_BASE_MS
  for (let i = 0; i < 10; i++) delay = nextTelegramPollDelayMs(delay, false)
  assert.equal(delay, TELEGRAM_POLL_MAX_MS)
  assert.equal(nextTelegramPollDelayMs(delay, true), TELEGRAM_POLL_BASE_MS)
})

// ---- formatter (white-box: pure function, also exercised through the real formatter registration) --

test('formatter concatenates back to the exact input for Korean and emoji text', async () => {
  const { formatTelegramReply } = await bundleModule('src/reply.ts')
  const text = '안녕하세요! 🎉🚀 결과가 도착했습니다. '.repeat(30) + '😀'.repeat(5)
  const { chunks } = formatTelegramReply({ text, maxChunkUtf16Units: 40, maxChunks: 200 })
  assert.equal(chunks.join(''), text)
  for (const chunk of chunks) assert.ok(chunk.length <= 40 + 1) // +1: the documented whole-pair exception
  // No chunk may contain a lone surrogate half.
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) assert.ok(i + 1 < chunk.length && chunk.charCodeAt(i + 1) >= 0xdc00 && chunk.charCodeAt(i + 1) <= 0xdfff)
      if (code >= 0xdc00 && code <= 0xdfff) assert.ok(i > 0 && chunk.charCodeAt(i - 1) >= 0xd800 && chunk.charCodeAt(i - 1) <= 0xdbff)
    }
  }
})

test('formatter never splits a surrogate pair even at a 1-unit cap', async () => {
  const { formatTelegramReply } = await bundleModule('src/reply.ts')
  const { chunks } = formatTelegramReply({ text: '😀😀', maxChunkUtf16Units: 1, maxChunks: 10 })
  assert.deepEqual(chunks, ['😀', '😀'])
  assert.equal(chunks.join(''), '😀😀')
})

test('formatter returns no chunks for empty text and adds no markers of its own', async () => {
  const { formatTelegramReply } = await bundleModule('src/reply.ts')
  assert.deepEqual(formatTelegramReply({ text: '', maxChunkUtf16Units: 10, maxChunks: 5 }).chunks, [])
  const { chunks } = formatTelegramReply({ text: 'exact-forty-char-one-chunk-of-text-here', maxChunkUtf16Units: 40, maxChunks: 5 })
  assert.deepEqual(chunks, ['exact-forty-char-one-chunk-of-text-here'])
})

test('formatter refuses to silently drop text that cannot fit the chunk budget', async () => {
  const { formatTelegramReply, TelegramReplyFormatError } = await bundleModule('src/reply.ts')
  assert.throws(
    () => formatTelegramReply({ text: 'x'.repeat(100), maxChunkUtf16Units: 10, maxChunks: 5 }),
    TelegramReplyFormatError,
  )
})

// ---- poll runtime: activation lifecycle / command flow / duplicates / stop-in-flight -----------

function fakeCapabilities(receivePages, { onControl, controlDelay } = {}) {
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
    if (permission === 'channels.ack') return { cursor: args.cursor }
    throw new Error(`unexpected capability: ${permission}`)
  }
  return { invokeCapability, calls }
}

test('activation lifecycle drives receive -> dispatch -> ack for each command', async () => {
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
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
  const runtime = createTelegramPollRuntime({
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
  // Every clientRequestId is the adapter's own bookkeeping, never reused as Core's key.
  const ids = controlCalls.map((call) => call.args.clientRequestId)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))

  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '6')
  // The ack only happens after every event in the batch dispatched.
  assert.ok(calls.indexOf(ackCalls[0]) > calls.lastIndexOf(controlCalls.at(-1)))
})

test('a message Telegram marks bot-authored is dropped, not dispatched, but still acked (R11)', async () => {
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
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
  const runtime = createTelegramPollRuntime({
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
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
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
  const runtime = createTelegramPollRuntime({
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

test('the default request-id minter works when crypto.randomUUID is absent (Desktop\'s data: URL host document is not a secure context)', async () => {
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
  const originalRandomUUID = crypto.randomUUID
  // `crypto.randomUUID` is secure-context-gated and simply absent on Desktop's extension host
  // document (a `data:` URL); `crypto.getRandomValues` is not gated and must be what the default
  // minter actually uses, or dispatch silently stops working there (see `pollLoop.ts`'s doc
  // comment and `scripts/channel-artifact-host-probe.ts`'s `cursorNeverAdvanced` observation).
  delete crypto.randomUUID
  try {
    const page1 = { events: [envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })], cursor: '1' }
    const emptyPage = { events: [], cursor: '1' }
    const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

    let stopped
    const stoppedSignal = new Promise((resolve) => { stopped = resolve })
    const runtime = createTelegramPollRuntime({
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
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
  const repeated = envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })
  // Core re-offering the same window twice models a redelivery (e.g. the adapter's own ack call
  // failed after Core had already durably advanced) rather than a protocol violation.
  const page1 = { events: [repeated], cursor: '1' }
  const page2 = { events: [repeated], cursor: '1' }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, page2, emptyPage])

  let iterations = 0
  // Yields a real macrotask each iteration: a `sleep` that only resolved via microtasks would
  // starve the test's own `setImmediate` polling below and hang the suite forever.
  const runtime = createTelegramPollRuntime({
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
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/projects' }),
    ],
    cursor: '2',
  }
  let releaseFirstControl
  const firstControlStarted = new Promise((resolve) => {
    releaseFirstControl = () => resolve()
  })
  let stopPromise
  const { invokeCapability, calls } = fakeCapabilities([page1], {
    controlDelay: async (args) => {
      if (args.eventHandle === 'h1') {
        // Stop lands while Core is still processing the first event's control call.
        stopPromise = runtime.stop()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
  })

  const runtime = createTelegramPollRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await stopPromise

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h1'])
  assert.equal(calls.filter((call) => call.permission === 'channels.ack').length, 0)
})

test('a receive failure backs off and does not ack, then recovers on the next window', async () => {
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
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
  const runtime = createTelegramPollRuntime({
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
  // No injected `sleep`: this exercises the runtime's own default, cancellable timer against the
  // real `setTimeout`/`clearTimeout` (mocked here only so the 30s cap is reached without the test
  // actually waiting 30 real seconds). Desktop's `ExtensionHostManager` lifecycle deadline for a
  // channel handler to settle is far shorter than 30s; an uncancelled timer here would make `stop`
  // time out and get the connection force-isolated instead of shutting down cleanly.
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
  const { TELEGRAM_POLL_MAX_MS } = await bundleModule('src/backoff.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const invokeCapability = async (permission) => {
    if (permission === 'channels.receive') return { events: [], cursor: null }
    return {}
  }
  const runtime = createTelegramPollRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()

  // Advance the mocked clock through enough idle rounds to park well past the point the backoff
  // caps at `TELEGRAM_POLL_MAX_MS`; `setImmediate` is real (not mocked) and just flushes the
  // microtasks each resolved timer queues before the next tick.
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(TELEGRAM_POLL_MAX_MS)
    await new Promise((resolve) => setImmediate(resolve))
  }

  const settledWithoutTicking = await Promise.race([
    runtime.stop().then(() => true),
    // A real, un-mocked macrotask: if `stop` were still waiting on the mocked 30s timer instead of
    // cancelling it, nothing would resolve it (this test never ticks again) and this wins first.
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ])
  assert.equal(settledWithoutTicking, true)
})

test('a stale generation from a repeated start is discarded and stop waits for it too', async () => {
  const { createTelegramPollRuntime } = await bundleModule('src/pollLoop.ts')
  const calls = []
  let releaseStaleReceive
  const staleReceiveGate = new Promise((resolve) => { releaseStaleReceive = resolve })
  let receiveCount = 0
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, args })
    if (permission === 'channels.receive') {
      receiveCount += 1
      if (receiveCount === 1) {
        // Generation 1's own receive call, still in flight when generation 2 starts below.
        await staleReceiveGate
        return { events: [envelope({ eventHandle: 'stale', semanticMessageId: 'stale-msg' })], cursor: '1' }
      }
      return { events: [], cursor: null }
    }
    return {}
  }

  const runtime = createTelegramPollRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start() // generation 1
  runtime.start() // generation 2, started while generation 1's receive() is still pending

  releaseStaleReceive()
  await runtime.stop()

  // The event generation 1 was mid-fetch for resolved only after generation 2 took over; the
  // epoch check inside `receive()` must have discarded it before it ever reached dispatch.
  assert.ok(!calls.some((call) => call.permission === 'sessions.control' && call.args.eventHandle === 'stale'))
  // `stop` must not return until generation 1 has actually finished unwinding, not merely until
  // generation 2 (the one `start` most recently assigned) has.
  const callCountAtStop = calls.length
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, callCountAtStop)
})

// ---- real activation wiring through the packed artifact + SDK test host -----------------------

test('the packaged extension wires channels.receive polling and the formatter through the real host', async () => {
  const packed = await packedTelegram()
  try {
    const calls = []
    let firstReceiveSeen
    const firstReceive = new Promise((resolve) => { firstReceiveSeen = resolve })
    const host = createTestHost('buzzni.telegram', {
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
      channelId: 'buzzni.telegram.bot',
      state: 'start',
      connectionId: 'conn-real',
      provider: 'telegram',
      connectionRevision: 1,
    })
    await firstReceive
    assert.ok(calls.some((call) => call.permission === 'channels.receive' && call.args.connectionId === 'conn-real'))

    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.telegram.bot',
      state: 'stop',
      connectionId: 'conn-real',
      provider: 'telegram',
      connectionRevision: 1,
    })

    const formatted = await host.formatChannelReply({
      apiVersion: 1,
      channelId: 'buzzni.telegram.bot',
      connectionId: 'conn-real',
      provider: 'telegram',
      connectionRevision: 1,
      requestId: 'req-1',
      kind: 'final',
      text: '결과: 완료 🎉',
      maxChunkUtf16Units: 4096,
      maxChunks: 8,
    })
    assert.deepEqual(formatted.chunks, ['결과: 완료 🎉'])

    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('a stop for a connection this host never started is a no-op', async () => {
  const packed = await packedTelegram()
  try {
    const host = createTestHost('buzzni.telegram', {
      async invokeCapability() { return { events: [], cursor: null } },
    })
    await host.activate(packed.extension)
    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.telegram.bot',
      state: 'stop',
      connectionId: 'conn-never-started',
      provider: 'telegram',
      connectionRevision: 1,
    })
    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})
