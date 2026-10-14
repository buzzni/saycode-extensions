/**
 * The board's grouping, pure (no DOM): which rows become cards, in which lane and which column.
 * Every placement rule comes from the IssueIndex — `descendants` for what is at the path, `homeOf` for the
 * milestone a row stands under, `shelvedAt` for deferral. This file only sorts those answers into a grid.
 * Epics and milestones are not cards; they are lane heads.
 */
import { displayOrder, isBacklog, isWork, LOST, NO_MILESTONE, type IssueIndex, type Path, type Row, type Seg } from '../data/index.js'
import type { ViewSettings } from '../store.js'

/** The columns a board has when the project's own list of statuses is not known, in board order. */
export const DEFAULT_STATUSES: readonly string[] = ['todo', 'in_progress', 'review', 'done']

/** The two columns that stand before the statuses. */
export const BACKLOG = 'backlog'
export const DEFERRED = 'deferred'

export interface BoardColumn {
  /** A status, or {@link BACKLOG} / {@link DEFERRED}. */
  key: string
  /** Index of the cards' rows, in display order. */
  cards: number[]
}

export interface BoardLane {
  /** The milestone's segment (`m:<id>`, {@link NO_MILESTONE}, {@link LOST}); null for the one lane inside a place. */
  seg: Seg | null
  /** The milestone row of the lane, when it has one. */
  at?: number
  columns: BoardColumn[]
}

export interface BoardModel {
  /** Column keys in order, the same for every lane. */
  keys: string[]
  lanes: BoardLane[]
  /** Cards drawn, across all lanes. */
  total: number
}

export interface BoardLook {
  path: Path
  view: Pick<ViewSettings, 'hiddenStatuses' | 'hideDeferred' | 'hideBacklog'>
  /** The id under the cursor: its column stays even when hidden, so the cursor never vanishes. */
  cursor: string | null
}

/** The column a row stands in: backlog first, then deferred, then its status. */
export function columnOf(index: IssueIndex, at: number): string {
  const row = index.rows[at]!
  if (isBacklog(row)) return BACKLOG
  if (index.shelvedAt(at) !== undefined) return DEFERRED
  return String(row.status ?? DEFAULT_STATUSES[0])
}

/** Statuses of the board: the known ones in order, then any other status found in the rows, in first-seen order. */
export function statusKeys(rows: readonly Row[], known: readonly string[] = DEFAULT_STATUSES): string[] {
  const keys = [...known]
  for (const row of rows) {
    if (!isWork(row) || row.status === undefined) continue
    const status = String(row.status)
    if (!keys.includes(status)) keys.push(status)
  }
  return keys
}

/** The lane a row stands in at the root: the first step of its home, else the `(no milestone)` lane. */
function laneOf(index: IssueIndex, at: number): Seg {
  const first = index.homeOf(at)[0]
  return first !== undefined && (first.startsWith('m:') || first === LOST) ? first : NO_MILESTONE
}

export function groupBoard(index: IssueIndex, look: BoardLook, known: readonly string[] = DEFAULT_STATUSES): BoardModel {
  const { path, view, cursor } = look
  const all = [BACKLOG, DEFERRED, ...statusKeys(index.rows, known)]
  const hidden = new Set(view.hiddenStatuses)
  const hides = (key: string) =>
    key === BACKLOG ? view.hideBacklog : key === DEFERRED ? view.hideDeferred : hidden.has(key)

  const cards = index.descendants(path).filter((at) => {
    const row = index.rows[at]!
    return index.find(row.id) === at && (isWork(row) || isBacklog(row))
  })
  const cursorAt = cursor === null ? undefined : index.find(cursor)
  const cursorColumn = cursorAt === undefined ? undefined : columnOf(index, cursorAt)

  // A hidden column goes; a card that has the cursor keeps its column on the board.
  const shown = (at: number) => {
    const key = columnOf(index, at)
    return !hides(key) || at === cursorAt
  }
  const keys = all.filter((key) => !hides(key) || key === cursorColumn)
  const kept = cards.filter(shown)

  const order = (a: number, b: number) => displayOrder(index.rows[a]!, index.rows[b]!)
  const make = (seg: Seg | null, members: number[], at?: number): BoardLane => ({
    seg,
    at,
    columns: keys.map((key) => ({ key, cards: members.filter((m) => columnOf(index, m) === key).sort(order) })),
  })

  if (path.length) return { keys, lanes: kept.length ? [make(null, kept)] : [], total: kept.length }

  const bySeg = new Map<Seg, number[]>()
  for (const at of kept) {
    const seg = laneOf(index, at)
    const list = bySeg.get(seg)
    if (list) list.push(at)
    else bySeg.set(seg, [at])
  }
  // Milestones in the listing's order, `(no milestone)` and `(lost)` after them.
  const order0 = index.entries([]).filter((entry) => entry.dir).map((entry) => entry.seg)
  const segs = [...bySeg.keys()].sort((a, b) => {
    const rank = (seg: Seg) => (seg === NO_MILESTONE ? 1e6 : seg === LOST ? 1e6 + 1 : order0.indexOf(seg))
    return rank(a) - rank(b)
  })
  const lanes = segs.map((seg) => {
    const home = seg.startsWith('m:') && seg !== NO_MILESTONE ? index.find(seg.slice(2)) : undefined
    return make(seg, bySeg.get(seg)!, home)
  })
  return { keys, lanes, total: kept.length }
}
