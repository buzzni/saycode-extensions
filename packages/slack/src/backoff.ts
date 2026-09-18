/**
 * Bounded backoff for the `channels.receive` intake-drain loop.
 *
 * Core's socket ingress admits Slack events in real time, but the wire protocol between Desktop
 * and the extension host has no "new work is waiting" push (`ExtensionWireEvent` only carries
 * `ready`/`log`/`contributionsChanged`) — so the extension still has to ask via `channels.receive`
 * on its own cadence, same as Telegram's long-poll. Doubling on an empty window keeps an idle
 * connection from hammering the capability; resetting to the base the instant a window has events
 * keeps a live conversation responsive.
 */

export const SLACK_RECEIVE_BASE_MS = 1_000
export const SLACK_RECEIVE_MAX_MS = 30_000

export function nextSlackReceiveDelayMs(currentDelayMs: number, hadEvents: boolean): number {
  if (hadEvents) return SLACK_RECEIVE_BASE_MS
  return Math.min(Math.max(currentDelayMs, SLACK_RECEIVE_BASE_MS) * 2, SLACK_RECEIVE_MAX_MS)
}
