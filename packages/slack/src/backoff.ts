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
/**
 * The ceiling while Core simply has nothing waiting. It is also the longest a message that arrives
 * during a quiet stretch waits before this adapter sees it, since nothing tells the adapter it
 * arrived; at 30s a follow-up sent after a short pause sat in Core's queue for up to that long.
 */
export const SLACK_RECEIVE_IDLE_MAX_MS = 3_000
/** The ceiling after a failed call, so a broken capability is not retried every few seconds. */
export const SLACK_RECEIVE_MAX_MS = 30_000

/** `idleMaxMs` is raised to `SLACK_RECEIVE_MAX_MS` when Core wakes the loop itself (an intake hint). */
export function nextSlackReceiveDelayMs(
  currentDelayMs: number, hadEvents: boolean, failed = false, idleMaxMs = SLACK_RECEIVE_IDLE_MAX_MS,
): number {
  if (hadEvents) return SLACK_RECEIVE_BASE_MS
  return Math.min(Math.max(currentDelayMs, SLACK_RECEIVE_BASE_MS) * 2, failed ? SLACK_RECEIVE_MAX_MS : idleMaxMs)
}
