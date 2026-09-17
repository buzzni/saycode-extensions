import type { ExtensionContext, JsonValue } from '@buzzni/saycode-extension-sdk'

import { nextTelegramPollDelayMs, TELEGRAM_POLL_BASE_MS } from './backoff.js'
import { parseTelegramCommand } from './commands.js'

/** The subset of `channels.receive`'s envelope this adapter reads. Core mints and owns the rest. */
export interface TelegramInboundEnvelope {
  eventHandle: string
  connectionRevision: number
  semanticMessageId: string
  text: string
  /** R11: Core's own sender record; `sender.bot` is Telegram's own bot-authored flag. */
  sender: { bot: boolean }
}

interface TelegramReceiveResult {
  events: readonly TelegramInboundEnvelope[]
  cursor: string
}

export interface TelegramPollRuntimeDeps {
  invokeCapability: ExtensionContext['invokeCapability']
  connectionId: string
  /** 1-50, matching Core's `MAX_CHANNEL_RECEIVE_EVENTS`; Core still enforces its own ceiling. */
  maxEvents?: number
  dedupeCapacity?: number
  sleep?(ms: number): Promise<void>
  mintClientRequestId?(): string
  onError?(error: unknown): void
}

export interface TelegramPollRuntime {
  /** Idempotent: starting an already-running runtime restarts it under a fresh epoch. */
  start(): void
  /** Idempotent and awaitable: resolves once the in-flight iteration has actually exited. */
  stop(): Promise<void>
}

/**
 * `crypto.randomUUID()` throws outside a secure context, and Desktop's extension host document is
 * a `data:` URL — not a trustworthy origin, so `window.isSecureContext` is `false` there and the
 * method is simply absent. `crypto.getRandomValues` has no such restriction (only the
 * secure-context-gated parts of `crypto` — `randomUUID`, `subtle` — are gated), so it works in both
 * contexts and is used unconditionally rather than branched on. This ID is the adapter's own
 * dedupe bookkeeping, never a value Core mints or trusts, so it only needs to look unique — the
 * UUID v4 shape is kept for readability in logs, not because any consumer parses it as one.
 */
/** Fails closed: a missing `sender` or a non-boolean `bot` is treated as bot-authored, never dispatched. */
function isBotSender(sender: unknown): boolean {
  const bot = (sender as { bot?: unknown } | null | undefined)?.bot
  return typeof bot !== 'boolean' || bot
}

function defaultMintClientRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Consumes durable intake with `channels.receive`/`channels.ack` and dispatches each message
 * through `sessions.control`. Never calls `channels.send`: Telegram's `sendMessage` executes
 * inside Core (the provider contract's `outbound` operation), and — as of the current Core
 * wiring — a successful `sessions.control` result is delivered through Core's own durable outbox
 * automatically. This runtime's only output is the control call itself.
 *
 * The manifest still declares `channels.send` even though nothing here invokes it: Desktop's
 * `ExtensionHostManager.formatChannelReply` gates the *formatter* registration on that same
 * permission, since a formatter that reshapes Core's approved text for an outside package is
 * exactly the authority that permission names (see `index.ts`'s `registerFormatter` call).
 *
 * Four invariants worth naming because each is a thing a naive poll loop gets wrong:
 *
 * - **A message Telegram marks bot-authored is dropped, not dispatched** (R11) — but still
 *   acknowledged, so it never blocks the cursor or gets re-offered forever. `sender.bot` is the
 *   only signal this adapter has; Core's own sender-trust module may already filter upstream. A
 *   missing `sender` or a non-boolean `bot` fails closed — treated as bot-authored — rather than
 *   trusting a malformed envelope as human.
 * - **A cursor only advances after a full batch is durably acknowledged.** `channels.receive`
 *   hands back one `cursor` for the whole window, not one per event, so there is no such thing as
 *   partially acking a batch — the loop acks all of it or none of it. If dispatch fails or `stop`
 *   lands mid-batch, the local cursor stays where it was and the same window is re-offered next
 *   time, which is deliberate at-least-once redelivery, not a bug.
 * - **`stop` takes effect between awaits, not by cancelling an in-flight call.** A `sessions.control`
 *   call already sent to Core cannot be un-sent, so `stop` bumps an epoch counter that every
 *   resumption point checks; the loop stops *scheduling new work*, and an already-claimed message
 *   is left for Core's own execution to finish.
 * - **A message already dispatched in this runtime's lifetime is never dispatched again**, even if
 *   Core's window re-offers it before the ack lands. Core's own intake also refuses a second claim
 *   for the same message, but that still costs a round trip; this is a cheap first line.
 * - **`stop` wakes an idle backoff sleep instead of waiting it out.** The backoff caps at 30s
 *   (`TELEGRAM_POLL_MAX_MS`), and Desktop's `ExtensionHostManager` lifecycle deadline for a
 *   channel handler to settle is far shorter than that — an uncancellable `setTimeout` here would
 *   make an idle connection's `stop` time out and get force-isolated instead of shutting down
 *   cleanly. So the default delay is a single cancellable timer, and both `start` (a fresh epoch
 *   invalidating a stale one) and `stop` clear it immediately rather than leaving it to fire.
 * - **`stop` waits for every generation still unwinding, not only the latest.** `start` called
 *   again while a previous loop's own `runOnce` is still in flight (not sleeping — mid network
 *   call) does not cancel that call; it only bumps the epoch that call checks on its next resume
 *   point, and only the current generation goes on to dispatch or ack (the epoch check before
 *   each capability call guarantees that). But the stale generation's `loop()` promise is still
 *   settling in the background, and a `stop` that awaited only the newest generation could resolve
 *   while that older one had not yet exited. So every generation's promise is tracked until it
 *   actually finishes, and `stop` awaits the whole set.
 */
export function createTelegramPollRuntime(deps: TelegramPollRuntimeDeps): TelegramPollRuntime {
  const maxEvents = Math.min(Math.max(deps.maxEvents ?? 20, 1), 50)
  const dedupeCapacity = Math.max(deps.dedupeCapacity ?? 200, 1)
  const mintClientRequestId = deps.mintClientRequestId ?? defaultMintClientRequestId

  let cursor: string | null = null
  let delayMs = TELEGRAM_POLL_BASE_MS
  let epoch = 0
  // Every generation's `loop()` promise, removed as each settles; `stop` awaits the whole set so a
  // stale generation still unwinding is never left running past `stop`'s own resolution.
  const inFlightGenerations = new Set<Promise<void>>()
  // At most one delay is ever pending at a time (this runtime drives a single sequential loop), so
  // one cancel slot is enough. Only the *default* timer is cancellable this way — an injected
  // `deps.sleep` is the caller's own clock, used as-is.
  let cancelPendingDelay: (() => void) | null = null
  // Bounded FIFO: `Set` preserves insertion order, so the oldest key is always `.values().next()`.
  const dispatched = new Set<string>()

  function wake(): void {
    cancelPendingDelay?.()
    cancelPendingDelay = null
  }

  async function delay(ms: number): Promise<void> {
    if (deps.sleep) return deps.sleep(ms)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      // Node only (a number in the browser-targeted production bundle's own DOM lib, which has no
      // `unref`): keeps a real 30s timer from holding a Node test process open after `stop`.
      ;(timer as unknown as { unref?: () => void }).unref?.()
      cancelPendingDelay = () => { clearTimeout(timer); resolve() }
    })
    cancelPendingDelay = null
  }

  function rememberDispatched(key: string): void {
    if (dispatched.has(key)) return
    dispatched.add(key)
    if (dispatched.size > dedupeCapacity) {
      const oldest = dispatched.values().next().value
      if (oldest !== undefined) dispatched.delete(oldest)
    }
  }

  async function receive(currentEpoch: number): Promise<TelegramReceiveResult | null> {
    const result = await deps.invokeCapability(
      'channels.receive',
      'channels.receive',
      { apiVersion: 1, connectionId: deps.connectionId, cursor, maxEvents } as unknown as JsonValue,
    )
    if (currentEpoch !== epoch) return null
    return result as unknown as TelegramReceiveResult
  }

  /** Resolves `true` once Core has accepted the control call, `false` if `stop` won the race. */
  async function dispatch(event: TelegramInboundEnvelope, currentEpoch: number): Promise<boolean> {
    const key = `${event.connectionRevision}:${event.semanticMessageId}`
    if (dispatched.has(key)) return true
    if (isBotSender(event.sender)) { rememberDispatched(key); return true }
    const command = parseTelegramCommand(event.text)
    await deps.invokeCapability(
      'sessions.control',
      'sessions.control',
      {
        apiVersion: 1,
        eventHandle: event.eventHandle,
        operation: command.operation,
        clientRequestId: mintClientRequestId(),
        ...(command.sessionRef === undefined ? {} : { sessionRef: command.sessionRef }),
        ...(command.text === undefined ? {} : { text: command.text }),
      } as unknown as JsonValue,
    )
    if (currentEpoch !== epoch) return false
    rememberDispatched(key)
    return true
  }

  async function runOnce(currentEpoch: number): Promise<void> {
    let result: TelegramReceiveResult | null
    try {
      result = await receive(currentEpoch)
    } catch (error) {
      if (currentEpoch !== epoch) return
      deps.onError?.(error)
      delayMs = nextTelegramPollDelayMs(delayMs, false)
      await delay(delayMs)
      return
    }
    if (result === null) return // stopped while the receive call was in flight

    let batchComplete = true
    for (const event of result.events) {
      if (currentEpoch !== epoch) { batchComplete = false; break }
      try {
        if (!(await dispatch(event, currentEpoch))) { batchComplete = false; break }
      } catch (error) {
        deps.onError?.(error)
        batchComplete = false
        break
      }
    }
    if (currentEpoch !== epoch) return

    const hadEvents = result.events.length > 0
    if (batchComplete && hadEvents) {
      try {
        await deps.invokeCapability(
          'channels.ack',
          'channels.ack',
          { apiVersion: 1, connectionId: deps.connectionId, cursor: result.cursor } as unknown as JsonValue,
        )
        if (currentEpoch !== epoch) return
        cursor = result.cursor
      } catch (error) {
        deps.onError?.(error)
        batchComplete = false
      }
    }

    delayMs = nextTelegramPollDelayMs(delayMs, batchComplete && hadEvents)
    await delay(delayMs)
  }

  async function loop(currentEpoch: number): Promise<void> {
    while (currentEpoch === epoch) {
      await runOnce(currentEpoch)
    }
  }

  return {
    start() {
      epoch += 1
      wake() // a stale generation's idle backoff must not linger up to 30s past its own epoch
      delayMs = TELEGRAM_POLL_BASE_MS
      const currentEpoch = epoch
      const generation: Promise<void> = loop(currentEpoch)
        .catch((error) => deps.onError?.(error))
        .then(() => { inFlightGenerations.delete(generation) })
      inFlightGenerations.add(generation)
    },
    async stop() {
      epoch += 1
      wake()
      await Promise.allSettled(inFlightGenerations)
    },
  }
}
