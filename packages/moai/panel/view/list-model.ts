// The list view's pure half (design §4.1, §4.6–4.8; TUI nav.rs, view.rs, query.rs order): what the view
// toggles keep, the order rows sort in, the flat lines of the tree with open folders unfolded, the columns
// that fit, and the windowing math of the virtual scroll. No DOM; view/list.ts draws from these and
// tests/moai-e3-list.test.mjs checks them.

import { archiveCandidate, isBacklog, isGroup, LOST, NO_MILESTONE, pathKey, type IssueIndex, type Keep, type Order, type Path, type Row, type Seg, type Twig } from "../data/index.ts"
import { orderBy, type SortField as QuerySortField, type SortKey as QuerySortKey } from "../data/query.ts"
import type { ColumnName, SortField, SortKey, State, ViewSettings } from "../store.ts"
import { visibleColumns } from "./responsive.ts"

/** Days a done row stands before it reads as archived (moai's `archive_days` default). */
export const ARCHIVE_DAYS = 14

/** One line of the list. `key` is what the store's cursor holds for it: a row's id, `..`, or a bucket's seg. */
export type ListLine =
  | { kind: "up"; key: string; depth: 0; path: Path }
  | { kind: "bucket"; key: string; depth: number; twig: Twig; seg: Seg; path: Path; open: boolean }
  | { kind: "row"; key: string; depth: number; twig: Twig; at: number; dir: boolean; path: Path | null; open: boolean }

export const UP_KEY = ".."

/** A row's column: a group's is read from its members. */
export function statusOf(row: Row): string {
  const status = isGroup(row) ? row.derived_status ?? row.status : row.status
  return typeof status === "string" ? status : ""
}

/**
 * What dates a group for the archive (data/index.ts archiveCandidate): the work under it, each by the day it
 * got to its column. A member that is put off is not counted, but a group that reads done by putting its
 * remaining members off counts from the day they were put off (moai's `report::Stand::entered`); the group's
 * own deferral does not take its members out of the count.
 */
function stamps(index: IssueIndex, at: number): Row[] {
  const group = index.rows[at]!
  const out: Row[] = []
  for (const member of index.progress(index.dirPath(at)).work) {
    const row = index.rows[member]!
    const shelf = index.shelvedAt(member)
    if (shelf === undefined || shelf === group.id) {
      out.push(row)
      continue
    }
    const holder = index.find(shelf)
    const since = holder === undefined ? undefined : index.rows[holder]!.deferred_at
    if (typeof since === "string") out.push({ id: row.id, status_since: since })
  }
  return out
}

/** What the view toggles keep (`SPC v`): hidden columns, deferred, backlog and archived rows go. */
export function viewKeep(view: ViewSettings, index: IssueIndex, now: Date = new Date(), archiveDays = ARCHIVE_DAYS): Keep {
  const hidden = new Set(view.hiddenStatuses)
  return (at) => {
    const row = index.rows[at]!
    if (hidden.size && hidden.has(statusOf(row))) return false
    if (view.hideDeferred && index.shelvedAt(at) !== undefined) return false
    if (view.hideBacklog && isBacklog(row)) return false
    if (view.showArchived) return true
    return !archiveCandidate(row, now, archiveDays, isGroup(row) ? stamps(index, at) : undefined)
  }
}

/** How many rows under `path`, at any depth, the view hides. */
export function hiddenUnder(index: IssueIndex, path: Path, keep: Keep): number {
  let hidden = 0
  for (const at of index.descendants(path)) if (!keep(at)) hidden++
  return hidden
}

/** `SPC v a`: lift the column, deferred and backlog hiding; archived rows stay as they are. */
export const SHOW_ALL: Partial<ViewSettings> = { hiddenStatuses: [], hideDeferred: false, hideBacklog: false }

/** True when the toggles that "show all" lifts hide something. */
export const hidesAnything = (view: ViewSettings): boolean => view.hiddenStatuses.length > 0 || view.hideDeferred || view.hideBacklog

// ── order ──────────────────────────────────────────────────────────────

/** The direction a field sorts in when it is first chosen. */
export const defaultDescending = (field: SortField): boolean => field === "created" || field === "updated"

/** The store's sort fields under the names data/query.ts orders by (its `status` is the store's `column`). */
const QUERY_KEY: Record<SortField, QuerySortKey> = {
  priority: "priority",
  created: "created",
  updated: "updated",
  column: "status",
  assignee: "assignee",
  title: "title",
}

/**
 * The rows' order for these sort keys. It is moai's `order_by` as data/query.ts ports it — the one that
 * tests/moai-query.test.mjs holds to the order `moai show --sort` prints: field by field (a title compares
 * without regard to case, an unassigned row goes last when ascending), then `(priority, id)`, or only the id
 * when the last field is a date. A second implementation here ordered titles by code unit (every capital
 * before every small letter) and kept a missing value last in both directions.
 */
export function sortCompare(sort: ReadonlyArray<SortKey>): (a: Row, b: Row) => number {
  // A field this table does not know (another module's name for one) orders nothing, instead of throwing.
  const fields: QuerySortField[] = sort.flatMap((key) => (QUERY_KEY[key.field] ? [{ key: QUERY_KEY[key.field], dir: key.descending ? ("desc" as const) : ("asc" as const) }] : []))
  return (a, b) => orderBy(a, b, fields)
}

/** {@link sortCompare} over the index's row positions, as {@link IssueIndex.entries} takes it. */
export function sortOrder(sort: ReadonlyArray<SortKey>, index: IssueIndex): Order {
  const compare = sortCompare(sort)
  return (a, b) => compare(index.rows[a]!, index.rows[b]!)
}

/** The order after clicking a column head, as `SPC s <key>`: that field alone, flipped when it already led. */
export function headSort(sort: ReadonlyArray<SortKey>, field: SortField): SortKey[] {
  const first = sort[0]
  if (first?.field === field) return [{ field, descending: !first.descending }]
  return [{ field, descending: defaultDescending(field) }]
}

// ── lines ──────────────────────────────────────────────────────────────

/**
 * The listing at `state.path` with the open folders unfolded in place: `..` first below the root, then each
 * level's folders, rows and buckets in {@link IssueIndex.entries} order.
 */
export function listLines(state: Pick<State, "path" | "expanded">, index: IssueIndex, keep: Keep, order: Order): ListLine[] {
  const open = new Set(state.expanded)
  const out: ListLine[] = []
  if (state.path.length) out.push({ kind: "up", key: UP_KEY, depth: 0, path: state.path.slice(0, -1) })
  const kin: boolean[] = []
  const walk = (here: Path) => {
    const entries = index.entries(here, keep, order)
    entries.forEach((entry, n) => {
      kin.push(n < entries.length - 1)
      const twig = [...kin]
      if (entry.dir) {
        const path = [...here, entry.seg]
        const opened = open.has(pathKey(path))
        if (entry.at === undefined) out.push({ kind: "bucket", key: entry.seg, depth: twig.length, twig, seg: entry.seg, path, open: opened })
        else out.push({ kind: "row", key: index.rows[entry.at]!.id, depth: twig.length, twig, at: entry.at, dir: true, path, open: opened })
        if (opened) walk(path)
      } else {
        out.push({ kind: "row", key: index.rows[entry.at]!.id, depth: twig.length, twig, at: entry.at, dir: false, path: null, open: false })
      }
      kin.pop()
    })
  }
  walk(state.path)
  return out
}

/** A line that opens as a folder (a bucket, or a row with something under it): where, and whether it is unfolded. */
export function folderOf(line: ListLine): { path: Path; open: boolean } | null {
  if (line.kind === "bucket" || (line.kind === "row" && line.dir && line.path)) return { path: line.path!, open: line.open }
  return null
}

/** The branch drawn before a line inside an unfolded folder (`│ ├─ └─`); nothing at the listing's own level. */
export function twigText(twig: Twig): string {
  if (twig.length < 2) return ""
  return twig.slice(1, -1).map((more) => (more ? "│ " : "  ")).join("") + (twig[twig.length - 1] ? "├─" : "└─")
}

/** The cursor key that names a place's last segment — where the cursor lands after leaving it. */
export function segKey(seg: Seg): string {
  if (seg === NO_MILESTONE || seg === LOST) return seg
  return seg.slice(2)
}

/** The line `delta` lines away from `key`, held at the ends; from no line, the first (or last) one. */
export function moveKey(lines: ReadonlyArray<ListLine>, key: string | null, delta: number): string | null {
  if (!lines.length) return null
  const at = key === null ? -1 : lines.findIndex((line) => line.key === key)
  if (at < 0) return lines[delta < 0 ? lines.length - 1 : 0]!.key
  return lines[Math.max(0, Math.min(lines.length - 1, at + delta))]!.key
}

/** Where the cursor goes on entering a place: its first line after `..`. */
export function firstKey(lines: ReadonlyArray<ListLine>): string | null {
  return lines.find((line) => line.kind !== "up")?.key ?? null
}

/** The folder line a line hangs under in the tree, or -1 at the listing's own level. */
export function parentLine(lines: ReadonlyArray<ListLine>, at: number): number {
  const depth = lines[at]?.depth ?? 0
  if (depth < 2) return -1
  for (let n = at - 1; n >= 0; n--) if (lines[n]!.depth === depth - 1) return n
  return -1
}

// ── columns ────────────────────────────────────────────────────────────

/** Right-hand columns, left to right. They drop out as the list narrows (view/responsive.ts). */
export type RightColumn = "tags" | "epic" | "assignee" | "created" | "updated"
const RIGHT: RightColumn[] = ["tags", "epic", "assignee", "created", "updated"]

export interface ColumnSet {
  id: boolean
  priority: boolean
  counts: boolean
  /** The sticky name line on top. */
  header: boolean
  right: RightColumn[]
}

/** The columns the user turned on that fit a list `width` px wide. */
export function columnSet(columns: Record<ColumnName, boolean>, width: number): ColumnSet {
  return {
    id: columns.id,
    priority: columns.priority,
    counts: columns.counts,
    header: columns.header,
    right: visibleColumns(width, RIGHT.filter((column) => columns[column])),
  }
}

/** The sort field a column head sorts by; heads without one do not sort. */
export const HEAD_SORT: Partial<Record<"priority" | "status" | "title" | RightColumn, SortField>> = {
  priority: "priority",
  status: "column",
  title: "title",
  assignee: "assignee",
  created: "created",
  updated: "updated",
}

const time = (value: unknown): number | undefined => {
  const at = typeof value === "string" ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : undefined
}

/** A date in 6ch: `MM-DD` this year, the year otherwise; empty when unreadable. */
export function shortDate(value: unknown, now: Date = new Date()): string {
  const at = time(value)
  if (at === undefined) return ""
  const date = new Date(at)
  if (date.getFullYear() !== now.getFullYear()) return String(date.getFullYear())
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

/** The column glyph (look-and-feel §6): the glyph differs, so colour never carries the status alone. */
export function statusGlyph(status: string): { glyph: string; tone: string } {
  switch (status) {
    case "todo":
      return { glyph: "·", tone: "todo" }
    case "in_progress":
      return { glyph: "▸", tone: "in_progress" }
    case "review":
      return { glyph: "?", tone: "review" }
    case "done":
      return { glyph: "✓", tone: "done" }
    default:
      return { glyph: "○", tone: "other" }
  }
}

// ── windowing ──────────────────────────────────────────────────────────

/** Rows drawn above and below the visible ones, so a quick scroll does not show blank space. */
export const OVERSCAN = 8

export interface WindowInput {
  /** The scroller's offset and visible height. */
  scrollTop: number
  viewport: number
  /** Where the first row starts in the scroller's content. */
  offset: number
  rowHeight: number
  count: number
  overscan?: number
}

/** The rows `[start, end)` to draw for this scroll position. */
export function windowRange(input: WindowInput): { start: number; end: number } {
  const overscan = input.overscan ?? OVERSCAN
  const top = Math.max(0, input.scrollTop - input.offset)
  const first = Math.floor(top / input.rowHeight)
  const last = Math.ceil((top + Math.max(0, input.viewport)) / input.rowHeight)
  const start = Math.max(0, Math.min(input.count, first - overscan))
  const end = Math.max(start, Math.min(input.count, last + overscan))
  return { start, end }
}

/**
 * The scroll offset that shows a row whole: unchanged when it is in view already. `inset` is what covers the
 * top of the viewport (the sticky name line).
 */
export function revealOffset(scrollTop: number, viewport: number, top: number, height: number, inset = 0): number {
  if (top < scrollTop + inset) return Math.max(0, top - inset)
  if (top + height > scrollTop + viewport) return Math.max(0, top + height - viewport)
  return scrollTop
}
