import type { ExtensionContext, JsonValue } from '@buzzni/saycode-extension-sdk'

import { nextDiscordReceiveDelayMs, DISCORD_RECEIVE_BASE_MS } from './backoff.js'
import { mapDiscordStructuredCommand, parseDiscordCommand, type DiscordStructuredCommand } from './commands.js'

/** The subset of `channels.receive`'s envelope this adapter reads. Core mints and owns the rest. */
export interface DiscordInboundEnvelope {
  eventHandle: string
  connectionRevision: number
  semanticMessageId: string
  text: string
  /** R11: Core's own sender record; `sender.bot` is Discord's own `author.bot` flag. */
  sender: { bot: boolean }
  /**
   * Present only when Core itself resolved this event as a validated approval-button click (its
   * own inbound mapping reading the `custom_id` it minted — see `approval.ts`), never derived from
   * `text`. Its presence, not any string inside `text`, is what routes this event to
   * `sessions.approveOnce` instead of `sessions.control` below.
   */
  action?: { approvalHandle: string; decision: 'approve' | 'deny' }
  /**
   * Present only when Core itself resolved this event as a real Discord Application Command
   * interaction (P3 contract), never derived from `text`. When present it takes priority over
   * `text`/`parseDiscordCommand` entirely — see `mapDiscordStructuredCommand`.
   */
  command?: DiscordStructuredCommand
}

interface DiscordReceiveResult {
  events: readonly DiscordInboundEnvelope[]
  cursor: string
}

export interface DiscordIntakeRuntimeDeps {
  invokeCapability: ExtensionContext['invokeCapability']
  connectionId: string
  /** 1-50, matching Core's `MAX_CHANNEL_RECEIVE_EVENTS`; Core still enforces its own ceiling. */
  maxEvents?: number
  dedupeCapacity?: number
  sleep?(ms: number): Promise<void>
  mintClientRequestId?(): string
  onError?(error: unknown): void
}

export interface DiscordIntakeRuntime {
  /** Idempotent: starting an already-running runtime restarts it under a fresh epoch. */
  start(): void
  /** Idempotent and awaitable: resolves once the in-flight iteration has actually exited. */
  stop(): Promise<void>
}

/**
 * `crypto.randomUUID()` throws outside a secure context, and Desktop's extension host document is
 * a `data:` URL — not a trustworthy origin (see `packages/telegram/src/pollLoop.ts`, fixed under
 * T14). `crypto.getRandomValues` has no such restriction, so it is used unconditionally.
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
 * through `sessions.control`. Structurally identical to Telegram's `createTelegramPollRuntime` and
 * Slack's `createSlackIntakeRuntime` — see `packages/telegram/src/pollLoop.ts`'s header for the
 * epoch/backoff/dedupe invariants this shares, duplicated for the same reason as `reply.ts`.
 *
 * A message Discord marks bot-authored is dropped, not dispatched (R11) — but still acknowledged,
 * so it never blocks the cursor or gets re-offered forever. `sender.bot` is the only signal this
 * adapter has; Core's own sender-trust module may already filter upstream. A missing `sender` or a
 * non-boolean `bot` fails closed — treated as bot-authored — rather than trusting a malformed
 * envelope as human.
 *
 * There is no `INTERACTION_CREATE` handling here at all: Core's inbound mapping does not surface
 * it (see `commands.ts`'s header), so a Discord Application Command reaches this loop only if it
 * was somehow admitted as a `MESSAGE_CREATE`-shaped envelope, which it never is.
 */
export function createDiscordIntakeRuntime(deps: DiscordIntakeRuntimeDeps): DiscordIntakeRuntime {
  const maxEvents = Math.min(Math.max(deps.maxEvents ?? 20, 1), 50)
  const dedupeCapacity = Math.max(deps.dedupeCapacity ?? 200, 1)
  const mintClientRequestId = deps.mintClientRequestId ?? defaultMintClientRequestId

  let cursor: string | null = null
  let delayMs = DISCORD_RECEIVE_BASE_MS
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

  async function receive(currentEpoch: number): Promise<DiscordReceiveResult | null> {
    const result = await deps.invokeCapability(
      'channels.receive',
      'channels.receive',
      { apiVersion: 1, connectionId: deps.connectionId, cursor, maxEvents } as unknown as JsonValue,
    )
    if (currentEpoch !== epoch) return null
    return result as unknown as DiscordReceiveResult
  }

  /** Resolves `true` once Core has accepted the control call (or the event was a bot echo), `false` if `stop` won the race. */
  async function dispatch(event: DiscordInboundEnvelope, currentEpoch: number): Promise<boolean> {
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
    const sendControl = async (operation: string, extra: { sessionRef?: string; text?: string }): Promise<boolean> => {
      await deps.invokeCapability(
        'sessions.control',
        'sessions.control',
        {
          apiVersion: 1,
          eventHandle: event.eventHandle,
          operation,
          clientRequestId: mintClientRequestId(),
          ...(extra.sessionRef === undefined ? {} : { sessionRef: extra.sessionRef }),
          ...(extra.text === undefined ? {} : { text: extra.text }),
        } as unknown as JsonValue,
      )
      if (currentEpoch !== epoch) return false
      rememberDispatched(key)
      return true
    }

    // A Core-normalized Application Command interaction takes priority over `text` entirely — see
    // `mapDiscordStructuredCommand`'s header for why `pair` and a missing required argument both
    // refuse here rather than falling back to `parseDiscordCommand`, which would risk turning a
    // pairing code (or a malformed interaction) into an ordinary prompt.
    if (event.command) {
      const proposal = mapDiscordStructuredCommand(event.command)
      if (!proposal) { rememberDispatched(key); return true }
      if (proposal.operation === 'select') return sendControl('select', { sessionRef: proposal.sessionRef })
      if (proposal.operation === 'prompt') return sendControl('prompt', { text: proposal.text })
      return sendControl(proposal.operation, {})
    }

    const command = parseDiscordCommand(event.text)
    return sendControl(command.operation, { sessionRef: command.sessionRef, text: command.text })
  }

  async function runOnce(currentEpoch: number): Promise<void> {
    let result: DiscordReceiveResult | null
    try {
      result = await receive(currentEpoch)
    } catch (error) {
      if (currentEpoch !== epoch) return
      deps.onError?.(error)
      delayMs = nextDiscordReceiveDelayMs(delayMs, false)
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

    delayMs = nextDiscordReceiveDelayMs(delayMs, batchComplete && hadEvents)
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
      delayMs = DISCORD_RECEIVE_BASE_MS
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
