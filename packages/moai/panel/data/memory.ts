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
import { SORT_KEYS, type Dir, type Sort, type SortField } from './query.js'
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
export function remember(store: Store, memory: Memory, defaults: SortDefault = sortDefault): () => void {
  store.dispatch({ type: 'restore', settings: memory.load() })
  const saved = defaults.get()
  if (saved) store.dispatch({ type: 'sort', sort: saved })
  return store.subscribe((state, previous) => {
    const now = rememberedOf(state)
    if (!sameMemory(now, rememberedOf(previous))) memory.save(now)
  })
}

// ── the default sort (E4 se-5air) ──────────────────────────────────────────────────────────────────────
//
// The sort editor's `D` keeps the order on screen as the one `reset sort` and a fresh opening return to. Nothing
// persists settings yet (the SDK is being asked for a settings-storage API), so it is kept through a
// {@link SettingsStorage} whose only implementation today is the session's own memory. A backend that persists
// plugs in under the same {@link SORT_DEFAULT_KEY} and the callers do not change.

/** Where the default sort is kept; a persisting backend is stored under this same key. */
export const SORT_DEFAULT_KEY = `${MEMORY_KEY}.sort`

/** A string store keyed by name: the seam a settings-storage API will fill. `null` clears a key. */
export interface SettingsStorage {
  read(key: string): string | null
  write(key: string, value: string | null): void
  /** False when what is written is lost with the session (the only kind there is until settings storage exists). */
  readonly persistent: boolean
}

/** The session-only storage: a copy in memory, gone when the panel closes. */
export function createSessionStorage(): SettingsStorage {
  const kept = new Map<string, string>()
  return {
    read: (key) => kept.get(key) ?? null,
    write(key, value) {
      if (value === null) kept.delete(key)
      else kept.set(key, value)
    },
    persistent: false,
  }
}

const isDir = (value: unknown): value is Dir => value === 'asc' || value === 'desc'

/** A stored order back to a {@link Sort}, or null when it is not a usable one (empty, unknown key, repeated key). */
export function normalizeSort(value: unknown): Sort | null {
  if (!isRecord(value) || !Array.isArray(value.fields) || value.fields.length === 0) return null
  const fields: SortField[] = []
  for (const one of value.fields) {
    if (!isRecord(one) || !isDir(one.dir)) return null
    const key = SORT_KEYS.find((candidate) => candidate === one.key)
    if (!key || fields.some((field) => field.key === key)) return null
    fields.push({ key, dir: one.dir })
  }
  return { fields, reversed: value.reversed === true }
}

export interface SortDefault {
  /** The saved default, or null when none was saved. */
  get(): Sort | null
  set(sort: Sort): void
  clear(): void
  /** False while the default lasts for this session only. */
  readonly persistent: boolean
}

export function createSortDefault(storage: SettingsStorage = createSessionStorage(), key: string = SORT_DEFAULT_KEY): SortDefault {
  return {
    get() {
      const text = storage.read(key)
      if (text === null) return null
      try {
        return normalizeSort(JSON.parse(text))
      } catch {
        return null
      }
    },
    set(sort) {
      storage.write(key, JSON.stringify({ fields: sort.fields, reversed: sort.reversed }))
    },
    clear() {
      storage.write(key, null)
    },
    get persistent() {
      return storage.persistent
    },
  }
}

/** The panel's one default sort, shared by the key wiring (`D`, reset) and {@link remember} (load). */
export const sortDefault: SortDefault = createSortDefault()
