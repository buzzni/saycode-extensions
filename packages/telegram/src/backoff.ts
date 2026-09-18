/**
 * Bounded backoff for the `channels.receive` poll loop.
 *
 * Doubling on an empty window keeps an idle connection from hammering the capability; resetting to
 * the base the instant a window has events keeps a live conversation responsive. The cap exists so
 * a long idle stretch never drifts the adapter's own liveness signal (its next poll) out past
 * whatever Core or the user would consider it stuck.
 */

export const TELEGRAM_POLL_BASE_MS = 1_000
export const TELEGRAM_POLL_MAX_MS = 30_000

export function nextTelegramPollDelayMs(currentDelayMs: number, hadEvents: boolean): number {
  if (hadEvents) return TELEGRAM_POLL_BASE_MS
  return Math.min(Math.max(currentDelayMs, TELEGRAM_POLL_BASE_MS) * 2, TELEGRAM_POLL_MAX_MS)
}
