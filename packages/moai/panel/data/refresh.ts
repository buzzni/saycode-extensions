/**
 * Automatic refresh: while the panel is visible the list is read again every `intervalMs` (60 s by
 * default); while `isVisible` says hidden it does not poll, and becoming visible after the interval has passed
 * reads at once. In Desktop the panel only sees `document.visibilityState`, which follows the window: an
 * inactive Moai tool tab stays mounted and still counts as visible (a host signal is needed for that).
 * A manual refresh (the refresh-time button) reads now and restarts the interval. Reads never overlap:
 * a refresh asked for while one runs waits for it instead of starting another. After a write, ask for a
 * `fresh` read: a read that started before the write cannot hold its result, so that one is waited out
 * and a new read follows.
 *
 * Timers and visibility are injected so the schedule is tested without a DOM or real time.
 */

export interface Clock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface RefresherOptions {
  load: () => Promise<void>
  intervalMs?: number
  isVisible?: () => boolean
  clock?: Clock
}

export interface Refresher {
  /**
   * Reads now (unless a read is running, which it then joins) and restarts the interval. With `fresh`, a
   * running read is waited out and another one follows it.
   */
  refresh(options?: { fresh?: boolean }): Promise<void>
  /** Tell it the panel's visibility changed. */
  visibilityChanged(): void
  setInterval(ms: number): void
  stop(): void
  /** When the last read finished, or null before the first. */
  readonly lastLoaded: number | null
}

export const DEFAULT_INTERVAL_MS = 60_000

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export function createRefresher(options: RefresherOptions): Refresher {
  const clock = options.clock ?? systemClock
  const isVisible = options.isVisible ?? (() => true)
  let interval = options.intervalMs ?? DEFAULT_INTERVAL_MS
  let timer: unknown = null
  let inFlight: Promise<void> | null = null
  let lastLoaded: number | null = null
  let stopped = false

  const clear = () => {
    if (timer !== null) clock.clearTimeout(timer)
    timer = null
  }

  const schedule = () => {
    clear()
    if (stopped || !isVisible() || interval <= 0) return
    const since = lastLoaded === null ? interval : clock.now() - lastLoaded
    timer = clock.setTimeout(() => {
      timer = null
      background()
    }, Math.max(0, interval - since))
  }

  // A read nobody awaits must not end as an unhandled rejection; the load reports its own failures.
  const background = () => void refresh().catch(() => {})

  function refresh(how: { fresh?: boolean } = {}): Promise<void> {
    if (inFlight && how.fresh) {
      const after = () => refresh()
      return inFlight.then(after, after)
    }
    if (inFlight) return inFlight
    clear()
    inFlight = (async () => {
      try {
        await options.load()
      } finally {
        lastLoaded = clock.now()
        inFlight = null
        schedule()
      }
    })()
    return inFlight
  }

  return {
    refresh,
    visibilityChanged() {
      if (!isVisible()) return clear()
      if (inFlight) return
      if (lastLoaded !== null && clock.now() - lastLoaded >= interval) background()
      else schedule()
    },
    setInterval(ms) {
      interval = ms
      if (!inFlight) schedule()
    },
    stop() {
      stopped = true
      clear()
    },
    get lastLoaded() {
      return lastLoaded
    },
  }
}

/** `HH:MM:SS` in the panel's locale and time zone, as the tab bar shows it. */
export function refreshTime(at: number, locale?: string): string {
  return new Date(at).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}
