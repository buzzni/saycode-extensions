/**
 * The panel's one state and the actions that change it. The reducer is pure — no DOM, no I/O — so every
 * transition is tested with `node --test`; views subscribe and render from the state they are given.
 *
 * List and board share the cursor, path, filters and detail (the board is a layout of the list); the
 * wiki tab keeps its own page, trail and search.
 */
import type { Outcome } from './data/client.js'
import { pathKey, type Path, type Row } from './data/index.js'
// The split owns the layout rules (the 640px rule, the ratio bounds and defaults); the store keeps the choices.
import { effectivePosition, type DetailPosition } from './view/responsive.js'
import { DEFAULT_RATIO, normalizeRatio } from './view/split.js'

export type { DetailPosition }
export type Tab = 'board' | 'list' | 'wiki'
export type Focus = 'list' | 'detail'
export type SortField = 'priority' | 'created' | 'updated' | 'column' | 'assignee' | 'title'
export type ColumnName = 'id' | 'priority' | 'counts' | 'header' | 'tags' | 'epic' | 'assignee' | 'created' | 'updated'

export interface SortKey {
  field: SortField
  descending: boolean
}

export interface ViewSettings {
  /** Status columns hidden from the list and board (`SPC v 1~9`). */
  hiddenStatuses: string[]
  hideDeferred: boolean
  hideBacklog: boolean
  showArchived: boolean
}

export interface DetailSettings {
  visible: boolean
  position: DetailPosition
  /** The detail's share of the split, kept per position. */
  ratio: Record<DetailPosition, number>
}

/** A read the panel shows: its data once it arrived, and why the last attempt failed. */
export interface Loadable<T> {
  value: T | null
  loading: boolean
  problem: Outcome | null
}

export interface BoardData {
  rows: Row[]
  more: number
  /** When the rows were read (ms since epoch). */
  loadedAt: number
}

export interface DetailData {
  id: string
  row: Row
}

export interface WikiState {
  page: string | null
  trail: { slug: string; scroll: number }[]
  query: string
}

export interface State {
  tab: Tab
  path: Path
  /** The id under the cursor; null when nothing is chosen. */
  cursor: string | null
  focus: Focus
  /** Folders unfolded in the tree, as path keys. Kept for the session only, as in the TUI. */
  expanded: string[]
  detail: DetailSettings
  view: ViewSettings
  columns: Record<ColumnName, boolean>
  /** Columns the user has seen; a column added later starts at its default, one turned off stays off. */
  columnsKnown: ColumnName[]
  sort: SortKey[]
  search: string
  board: Loadable<BoardData>
  shown: Loadable<DetailData>
  wiki: WikiState
}

export const COLUMN_DEFAULTS: Record<ColumnName, boolean> = {
  id: true, priority: true, counts: true, header: true,
  tags: false, epic: false, assignee: false, created: false, updated: false,
}

export const DEFAULT_SORT: SortKey[] = [{ field: 'priority', descending: false }]

const idle = <T>(): Loadable<T> => ({ value: null, loading: false, problem: null })

export function initialState(): State {
  return {
    tab: 'list',
    path: [],
    cursor: null,
    focus: 'list',
    expanded: [],
    detail: { visible: true, position: 'bottom', ratio: { ...DEFAULT_RATIO } },
    view: { hiddenStatuses: [], hideDeferred: true, hideBacklog: false, showArchived: false },
    columns: { ...COLUMN_DEFAULTS },
    columnsKnown: Object.keys(COLUMN_DEFAULTS) as ColumnName[],
    sort: DEFAULT_SORT.map((key) => ({ ...key })),
    search: '',
    board: idle(),
    shown: idle(),
    wiki: { page: null, trail: [], query: '' },
  }
}

export type Action =
  | { type: 'tab'; tab: Tab }
  | { type: 'enter'; path: Path; cursor?: string | null }
  | { type: 'cursor'; id: string | null }
  | { type: 'focus'; focus: Focus }
  | { type: 'toggle-expanded'; path: Path }
  | { type: 'detail-visible'; visible: boolean }
  | { type: 'detail-position'; position: DetailPosition }
  /** `position` is the one resized — the split reports the position it shows, which a narrow panel forces to the bottom. */
  | { type: 'detail-ratio'; ratio: number; position?: DetailPosition }
  | { type: 'view'; view: Partial<ViewSettings> }
  | { type: 'column'; column: ColumnName; on: boolean }
  | { type: 'sort'; sort: SortKey[] }
  | { type: 'search'; text: string }
  | { type: 'board-loading' }
  /** `order` is the ids in the order they were drawn before this read, to place the cursor after it. */
  | { type: 'board-loaded'; data: BoardData; order?: string[] }
  | { type: 'board-failed'; problem: Outcome }
  | { type: 'detail-loading'; id: string }
  | { type: 'detail-loaded'; data: DetailData }
  | { type: 'detail-failed'; id: string; problem: Outcome }
  | { type: 'detail-closed' }

/** Where the detail actually stands at this panel width: a narrow panel forces the bottom. */
export const detailPosition = (detail: DetailSettings, width: number): DetailPosition => effectivePosition(width, detail.position)

/**
 * After a reload the cursor stays on the same id. When that row is gone it moves to the nearest row that
 * is still there — the next one in the old order, else the previous one.
 */
export function keepCursor(cursor: string | null, order: readonly string[], present: ReadonlySet<string>): string | null {
  if (cursor === null || present.has(cursor)) return cursor
  const at = order.indexOf(cursor)
  if (at < 0) return null
  for (let distance = 1; distance < order.length; distance++) {
    const after = order[at + distance]
    if (after !== undefined && present.has(after)) return after
    const before = order[at - distance]
    if (before !== undefined && present.has(before)) return before
  }
  return null
}

export function reduce(state: State, action: Action): State {
  switch (action.type) {
    case 'tab':
      return state.tab === action.tab ? state : { ...state, tab: action.tab }
    case 'enter':
      return { ...state, path: [...action.path], cursor: action.cursor === undefined ? state.cursor : action.cursor }
    case 'cursor':
      return state.cursor === action.id ? state : { ...state, cursor: action.id }
    case 'focus':
      return state.focus === action.focus ? state : { ...state, focus: action.focus }
    case 'toggle-expanded': {
      const key = pathKey(action.path)
      const expanded = state.expanded.includes(key) ? state.expanded.filter((k) => k !== key) : [...state.expanded, key]
      return { ...state, expanded }
    }
    case 'detail-visible':
      return { ...state, detail: { ...state.detail, visible: action.visible }, focus: action.visible ? state.focus : 'list' }
    case 'detail-position':
      return { ...state, detail: { ...state.detail, position: action.position } }
    case 'detail-ratio': {
      const position = action.position ?? state.detail.position
      const ratio = { ...state.detail.ratio, [position]: normalizeRatio(action.ratio, position) }
      return { ...state, detail: { ...state.detail, ratio } }
    }
    case 'view':
      return { ...state, view: { ...state.view, ...action.view } }
    case 'column':
      return {
        ...state,
        columns: { ...state.columns, [action.column]: action.on },
        columnsKnown: state.columnsKnown.includes(action.column) ? state.columnsKnown : [...state.columnsKnown, action.column],
      }
    case 'sort':
      return { ...state, sort: action.sort.length ? action.sort.map((key) => ({ ...key })) : DEFAULT_SORT.map((key) => ({ ...key })) }
    case 'search':
      return { ...state, search: action.text }
    case 'board-loading':
      return { ...state, board: { ...state.board, loading: true } }
    case 'board-loaded': {
      const present = new Set(action.data.rows.map((row) => row.id))
      return {
        ...state,
        board: { value: action.data, loading: false, problem: null },
        cursor: keepCursor(state.cursor, action.order ?? state.board.value?.rows.map((row) => row.id) ?? [], present),
      }
    }
    case 'board-failed':
      // The rows read before stay on screen; the problem is shown beside them.
      return { ...state, board: { ...state.board, loading: false, problem: action.problem } }
    case 'detail-loading':
      return { ...state, shown: { value: state.shown.value?.id === action.id ? state.shown.value : null, loading: true, problem: null } }
    case 'detail-loaded':
      return { ...state, shown: { value: action.data, loading: false, problem: null } }
    case 'detail-failed':
      return { ...state, shown: { value: null, loading: false, problem: action.problem } }
    case 'detail-closed':
      return { ...state, shown: idle(), focus: 'list' }
  }
}

export interface Store {
  getState(): State
  dispatch(action: Action): void
  subscribe(listener: (state: State, previous: State) => void): () => void
}

export function createStore(initial: State = initialState()): Store {
  let state = initial
  const listeners = new Set<(state: State, previous: State) => void>()
  return {
    getState: () => state,
    dispatch(action) {
      const previous = state
      state = reduce(state, action)
      if (state === previous) return
      for (const listener of [...listeners]) listener(state, previous)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
