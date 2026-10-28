/**
 * Bounded backoff for the `channels.receive` poll loop.
 *
 * Doubling on an empty window keeps an idle connection from hammering the capability; resetting to
 * the base the instant a window has events keeps a live conversation responsive. The cap exists so
 * a long idle stretch never drifts the adapter's own liveness signal (its next poll) out past
 * whatever Core or the user would consider it stuck.
 */

export const TELEGRAM_POLL_BASE_MS = 1_000
/**
 * The ceiling while Core simply has nothing waiting. It is also the longest a message that arrives
 * during a quiet stretch waits before this adapter sees it, since nothing tells the adapter it
 * arrived; at 30s a follow-up sent after a short pause sat in Core's queue for up to that long.
 */
export const TELEGRAM_POLL_IDLE_MAX_MS = 3_000
/** The ceiling after a failed call, so a broken capability is not retried every few seconds. */
export const TELEGRAM_POLL_MAX_MS = 30_000

export function nextTelegramPollDelayMs(currentDelayMs: number, hadEvents: boolean, failed = false): number {
  if (hadEvents) return TELEGRAM_POLL_BASE_MS
  return Math.min(Math.max(currentDelayMs, TELEGRAM_POLL_BASE_MS) * 2, failed ? TELEGRAM_POLL_MAX_MS : TELEGRAM_POLL_IDLE_MAX_MS)
}
