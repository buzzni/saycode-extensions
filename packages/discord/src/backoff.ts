/**
 * Bounded backoff for the `channels.receive` intake-drain loop.
 *
 * Same rationale as Slack's `backoff.ts`: Core's Gateway ingress admits Discord events in real
 * time, but the extension host wire protocol has no "new work is waiting" push, so the extension
 * still drains the durable queue on its own cadence.
 */

export const DISCORD_RECEIVE_BASE_MS = 1_000
/**
 * The ceiling while Core simply has nothing waiting. It is also the longest a message that arrives
 * during a quiet stretch waits before this adapter sees it, since nothing tells the adapter it
 * arrived; at 30s a follow-up sent after a short pause sat in Core's queue for up to that long.
 */
export const DISCORD_RECEIVE_IDLE_MAX_MS = 3_000
/** The ceiling after a failed call, so a broken capability is not retried every few seconds. */
export const DISCORD_RECEIVE_MAX_MS = 30_000

export function nextDiscordReceiveDelayMs(currentDelayMs: number, hadEvents: boolean, failed = false): number {
  if (hadEvents) return DISCORD_RECEIVE_BASE_MS
  return Math.min(Math.max(currentDelayMs, DISCORD_RECEIVE_BASE_MS) * 2, failed ? DISCORD_RECEIVE_MAX_MS : DISCORD_RECEIVE_IDLE_MAX_MS)
}
