import type { ExtensionContext, JsonValue } from '@buzzni/saycode-extension-sdk'

import { nextSlackReceiveDelayMs, SLACK_RECEIVE_BASE_MS } from './backoff.js'
import { parseSlackCommand } from './commands.js'

/** The subset of `channels.receive`'s envelope this adapter reads. Core mints and owns the rest. */
export interface SlackInboundEnvelope {
  eventHandle: string
  connectionRevision: number
  semanticMessageId: string
  text: string
  /** R11: Core's own sender record; `sender.bot` is Slack's echo of a bot-authored message. */
  sender: { bot: boolean }
  /**
   * Present only when Core itself resolved this event as a validated approval-button click (its
   * own inbound mapping reading the `action_id`/`custom_id` it minted — see `approval.ts`), never
   * derived from `text`. Its presence, not any string inside `text`, is what routes this event to
   * `sessions.approveOnce` instead of `sessions.control` below.
   */
  action?: { approvalHandle: string; decision: 'approve' | 'deny' }
}

interface SlackReceiveResult {
  events: readonly SlackInboundEnvelope[]
  cursor: string
}

export interface SlackIntakeRuntimeDeps {
  invokeCapability: ExtensionContext['invokeCapability']
  connectionId: string
  /** 1-50, matching Core's `MAX_CHANNEL_RECEIVE_EVENTS`; Core still enforces its own ceiling. */
  maxEvents?: number
  dedupeCapacity?: number
  sleep?(ms: number): Promise<void>
  mintClientRequestId?(): string
  onError?(error: unknown): void
}

export interface SlackIntakeRuntime {
  /** Idempotent: starting an already-running runtime restarts it under a fresh epoch. */
  start(): void
  /** Idempotent and awaitable: resolves once the in-flight iteration has actually exited. */
  stop(): Promise<void>
}

/**
 * `crypto.randomUUID()` throws outside a secure context, and Desktop's extension host document is
 * a `data:` URL — not a trustworthy origin (see `packages/telegram/src/pollLoop.ts`, fixed under
 * T14 after `scripts/channel-artifact-host-probe.ts` caught it live). `crypto.getRandomValues` has
 * no such restriction, so it is used unconditionally rather than branched on. This id is the
 * adapter's own dedupe bookkeeping, never a value Core mints or trusts.
 */
/** Fails closed: a missing `sender` or a non-boolean `bot` is treated as bot-authored, never dispatched. */
function isBotSender(sender: unknown): boolean {
  const bot = (sender as { bot?: unknown } | null | undefined)?.bot
  return typeof bot !== 'boolean' || bot
}

function defaultMintClientRequestId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Consumes durable intake with `channels.receive`/`channels.ack` and dispatches each message
 * through `sessions.control`. Structurally identical to Telegram's `createTelegramPollRuntime`
 * (`packages/telegram/src/pollLoop.ts`) — see that file's header for the epoch/backoff/dedupe
 * invariants this shares, duplicated rather than shared for the same reason as `reply.ts`.
 *
 * Two things are Slack-specific, both driven by what `channels.receive`'s envelope actually
 * carries and nothing more:
 *
 * - **A message Slack marks as bot-authored is dropped, not dispatched** (R11) — but still
 *   acknowledged, so it does not block the cursor or get re-offered forever. `sender.bot` is the
 *   only signal available; Core's own sender-trust module may already filter upstream, so this is
 *   belt-and-suspenders, not the only guard. A missing `sender` or a non-boolean `bot` fails
 *   closed — treated as bot-authored — rather than trusting a malformed envelope as human.
 * - **`message_changed` (Slack's edit-of-an-earlier-message event) cannot be detected here.**
 *   Core's Slack inbound mapping does not pass through `payload.event.subtype`, so an edited
 *   message arrives indistinguishable from a new one and is dispatched as a fresh prompt — a Core
 *   gap, not something this adapter can work around from the fields it is given.
 */
export function createSlackIntakeRuntime(deps: SlackIntakeRuntimeDeps): SlackIntakeRuntime {
  const maxEvents = Math.min(Math.max(deps.maxEvents ?? 20, 1), 50)
  const dedupeCapacity = Math.max(deps.dedupeCapacity ?? 200, 1)
  const mintClientRequestId = deps.mintClientRequestId ?? defaultMintClientRequestId

  let cursor: string | null = null
  let delayMs = SLACK_RECEIVE_BASE_MS
  let epoch = 0
  const inFlightGenerations = new Set<Promise<void>>()
  let cancelPendingDelay: (() => void) | null = null
  const dispatched = new Set<string>()

  function wake(): void {
    cancelPendingDelay?.()
    cancelPendingDelay = null
  }

  async function delay(ms: number): Promise<void> {
    if (deps.sleep) return deps.sleep(ms)
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
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

  async function receive(currentEpoch: number): Promise<SlackReceiveResult | null> {
    const result = await deps.invokeCapability(
      'channels.receive',
      'channels.receive',
      { apiVersion: 1, connectionId: deps.connectionId, cursor, maxEvents } as unknown as JsonValue,
    )
    if (currentEpoch !== epoch) return null
    return result as unknown as SlackReceiveResult
  }

  /** Resolves `true` once Core has accepted the control call (or the event was a bot echo), `false` if `stop` won the race. */
  async function dispatch(event: SlackInboundEnvelope, currentEpoch: number): Promise<boolean> {
    const key = `${event.connectionRevision}:${event.semanticMessageId}`
    if (dispatched.has(key)) return true
    if (isBotSender(event.sender)) { rememberDispatched(key); return true }
    if (event.action) {
      // No `clientRequestId`: `sessions.approveOnce`'s wire params are exactly
      // `{apiVersion, approvalHandle, eventHandle, decision}` — it is not a `sessions.control` call
      // wearing different arguments, and Core's own parser rejects an unknown field.
      await deps.invokeCapability(
        'sessions.approveOnce',
        'sessions.approveOnce',
        {
          apiVersion: 1,
          eventHandle: event.eventHandle,
          approvalHandle: event.action.approvalHandle,
          decision: event.action.decision,
        } as unknown as JsonValue,
      )
      if (currentEpoch !== epoch) return false
      rememberDispatched(key)
      return true
    }
    const command = parseSlackCommand(event.text)
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
    let result: SlackReceiveResult | null
    try {
      result = await receive(currentEpoch)
    } catch (error) {
      if (currentEpoch !== epoch) return
      deps.onError?.(error)
      delayMs = nextSlackReceiveDelayMs(delayMs, false)
      await delay(delayMs)
      return
    }
    if (result === null) return

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

    delayMs = nextSlackReceiveDelayMs(delayMs, batchComplete && hadEvents)
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
      wake()
      delayMs = SLACK_RECEIVE_BASE_MS
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
