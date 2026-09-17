/**
 * Bounded backoff for the `channels.receive` intake-drain loop.
 *
 * Same rationale as Slack's `backoff.ts`: Core's Gateway ingress admits Discord events in real
 * time, but the extension host wire protocol has no "new work is waiting" push, so the extension
 * still drains the durable queue on its own cadence.
 */

export const DISCORD_RECEIVE_BASE_MS = 1_000
export const DISCORD_RECEIVE_MAX_MS = 30_000

export function nextDiscordReceiveDelayMs(currentDelayMs: number, hadEvents: boolean): number {
  if (hadEvents) return DISCORD_RECEIVE_BASE_MS
  return Math.min(Math.max(currentDelayMs, DISCORD_RECEIVE_BASE_MS) * 2, DISCORD_RECEIVE_MAX_MS)
}
