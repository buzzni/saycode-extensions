/**
 * What the panel remembers between openings (design §5): the last tab, whether the detail shows, where it
 * stands and its share of the split for each position (`ratio.left`, `ratio.bottom`).
 *
 * Where it is kept: the panel bridge offers commands only (`invokeCommand`), no settings API, and the SDK's
 * `storage.read`/`storage.write` permissions are names without actions yet (docs/moai-panel/current-state.md).
 * So the settings go to the frame's localStorage when it can be used — a frame sandboxed without
 * `allow-same-origin` has an opaque origin, where touching localStorage throws SecurityError — and otherwise
 * stay in memory for the session. That is the order design §5 sets (localStorage → `storage.*` → session);
 * spike se-0g4a.y91 settles which one Desktop gives. Every access is guarded: a failing store never stops the
 * panel, it only forgets.
 *
 * {@link normalizeMemory} is pure and cleans whatever comes back, so a value from an older or newer panel,
 * or one edited by hand, still boots with usable settings.
 */
import type { DetailPosition, Remembered, State, Store } from '../store.js'
import { DEFAULT_RATIO, normalizeRatio } from '../view/split.js'
import { DEFAULT_TAB, normalizeTab } from '../view/tabs.js'

export const MEMORY_KEY = 'buzzni.moai.panel'
/** Written with the settings; a later panel that changes their shape reads this to migrate. */
export const MEMORY_VERSION = 1

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const normalizePosition = (value: unknown): DetailPosition => (value === 'left' ? 'left' : 'bottom')

/** Stored settings (parsed JSON, or anything else) to usable ones; what is missing or wrong takes its default. */
export function normalizeMemory(value: unknown): Remembered {
  const stored = isRecord(value) ? value : {}
  const detail = isRecord(stored.detail) ? stored.detail : {}
  const ratio = isRecord(detail.ratio) ? detail.ratio : {}
  return {
    tab: stored.tab === undefined ? DEFAULT_TAB : normalizeTab(stored.tab),
    detail: {
      visible: typeof detail.visible === 'boolean' ? detail.visible : true,
      position: normalizePosition(detail.position),
      ratio: {
        left: ratio.left === undefined ? DEFAULT_RATIO.left : normalizeRatio(ratio.left, 'left'),
        bottom: ratio.bottom === undefined ? DEFAULT_RATIO.bottom : normalizeRatio(ratio.bottom, 'bottom'),
      },
    },
  }
}

/** The part of the state that is remembered. */
export function rememberedOf(state: State): Remembered {
  const { visible, position, ratio } = state.detail
  return { tab: state.tab, detail: { visible, position, ratio: { left: ratio.left, bottom: ratio.bottom } } }
}

export function sameMemory(a: Remembered, b: Remembered): boolean {
  return (
    a.tab === b.tab &&
    a.detail.visible === b.detail.visible &&
    a.detail.position === b.detail.position &&
    a.detail.ratio.left === b.detail.ratio.left &&
    a.detail.ratio.bottom === b.detail.ratio.bottom
  )
}

/** The slice of the Web Storage API used here, so tests pass a plain object. */
export interface Backend {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface Memory {
  load(): Remembered
  save(settings: Remembered): void
  /** False once the backend could not be used: the settings then last for this session only. */
  readonly persistent: boolean
}

/**
 * Settings kept in `backend()` under `key`. The backend is a getter because reading `window.localStorage`
 * itself is what throws in an opaque origin. Anything that throws drops to an in-memory copy for the session.
 */
export function createMemory(backend: () => Backend | null | undefined, key: string = MEMORY_KEY): Memory {
  let storage: Backend | null = null
  try {
    storage = backend() ?? null
  } catch {
    storage = null
  }
  let session: string | null = null

  const read = (): string | null => {
    if (storage) {
      try {
        return storage.getItem(key)
      } catch {
        storage = null
      }
    }
    return session
  }

  return {
    load() {
      const text = read()
      if (text === null) return normalizeMemory(null)
      try {
        return normalizeMemory(JSON.parse(text))
      } catch {
        return normalizeMemory(null)
      }
    },
    save(settings) {
      const text = JSON.stringify({ version: MEMORY_VERSION, ...settings })
      session = text
      if (!storage) return
      try {
        storage.setItem(key, text)
      } catch {
        // Full, or blocked after all: keep the session copy and stop trying.
        storage = null
      }
    },
    get persistent() {
      return storage !== null
    },
  }
}

/**
 * Restores the remembered settings into the store, then saves them whenever they change. Returns the
 * unsubscribe. Call it before the views mount, so they first draw the restored tab and layout.
 */
export function remember(store: Store, memory: Memory): () => void {
  store.dispatch({ type: 'restore', settings: memory.load() })
  return store.subscribe((state, previous) => {
    const now = rememberedOf(state)
    if (!sameMemory(now, rememberedOf(previous))) memory.save(now)
  })
}
