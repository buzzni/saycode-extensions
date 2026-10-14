// Search / filter / sort toolbar of the list. State and reducer are pure (testable without the store);
// renderToolbar() turns a state into DOM through the shared components and reports every user act as an
// action. What is searched (rows, context) comes in through deps; where the state lives is the caller's.

import {
  GREP_SCOPES,
  SORT_KEYS,
  badFilterMessage,
  hiding,
  hintsAt,
  items,
  nextScope,
  parseFilter,
  prevScope,
  search,
  sortBadge,
  sortEdit,
  type Context,
  type Filter,
  type GrepScope,
  type Hint,
  type Slot,
  type Sort,
  type SortEdit,
  type SortKey,
} from "../data/query.ts"
import type { Row } from "../data/index.ts"
import { button, chip, el, icon, iconButton, menu, searchBox, textInput } from "./components.ts"

// ---- strings (local until the i18n catalogue takes them) ----------------------------------------------

export type Lang = "ko" | "en"

export const TOOLBAR_TEXT = {
  ko: {
    search: "검색",
    searchPlaceholder: "검색 (/)",
    scope: "검색 범위",
    scopes: { all: "전체", id: "ID", title: "제목", tag: "태그", body: "본문", note: "메모" } as Record<GrepScope, string>,
    filter: "필터",
    filterPlaceholder: "status=todo tag=bug,ui",
    removeChip: "필터 항목 지우기",
    hints: "자동 완성",
    sort: "정렬",
    sortEdit: "정렬 편집",
    reversed: "뒤집힘",
    asc: "오름차순",
    desc: "내림차순",
    replace: "이것만",
    append: "추가",
    flip: "방향 바꿈",
    sortKeys: { priority: "우선순위", created: "만든 때", updated: "고친 때", status: "상태", assignee: "담당", title: "제목", id: "ID" } as Record<SortKey, string>,
    hidden: "숨겨진 행",
    hiddenReasons: { done: "완료", backlog: "백로그", deferred: "보류", archived: "보관" } as Record<HiddenReason, string>,
  },
  en: {
    search: "Search",
    searchPlaceholder: "Search (/)",
    scope: "Search in",
    scopes: { all: "All", id: "ID", title: "Title", tag: "Tag", body: "Body", note: "Note" } as Record<GrepScope, string>,
    filter: "Filter",
    filterPlaceholder: "status=todo tag=bug,ui",
    removeChip: "Remove filter item",
    hints: "Suggestions",
    sort: "Sort",
    sortEdit: "Edit sort",
    reversed: "reversed",
    asc: "ascending",
    desc: "descending",
    replace: "Only this",
    append: "Add",
    flip: "Flip direction",
    sortKeys: { priority: "Priority", created: "Created", updated: "Updated", status: "Status", assignee: "Assignee", title: "Title", id: "ID" } as Record<SortKey, string>,
    hidden: "Hidden rows",
    hiddenReasons: { done: "done", backlog: "backlog", deferred: "deferred", archived: "archived" } as Record<HiddenReason, string>,
  },
} as const

export type HiddenReason = "done" | "backlog" | "deferred" | "archived"

// ---- state ----------------------------------------------------------------------------------------------

export interface ToolbarState {
  searchOpen: boolean
  searchText: string
  scope: GrepScope
  filterText: string
  /** Caret of the filter input (UTF-16 index); the hints follow it. */
  cursor: number
  /** The hint dropdown is shown. */
  hintsOpen: boolean
  /** Highlighted hint, -1 for none. */
  hintIndex: number
  sortOpen: boolean
  sort: Sort
}

export const initialToolbar = (): ToolbarState => ({
  searchOpen: false,
  searchText: "",
  scope: "all",
  filterText: "",
  cursor: 0,
  hintsOpen: false,
  hintIndex: -1,
  sortOpen: false,
  sort: { fields: [{ key: "priority", dir: "asc" }], reversed: false },
})

export type ToolbarAction =
  | { type: "search-open" }
  | { type: "search-close" }
  | { type: "search-text"; text: string }
  | { type: "scope-next" }
  | { type: "scope-prev" }
  | { type: "scope-set"; scope: GrepScope }
  | { type: "filter-text"; text: string; cursor: number }
  | { type: "filter-cursor"; cursor: number }
  | { type: "chip-remove"; index: number }
  | { type: "hints-open" }
  | { type: "hints-close" }
  | { type: "hint-move"; delta: number; count: number }
  | { type: "hint-accept"; slot: Slot; hint: Hint }
  | { type: "sort-toggle" }
  | { type: "sort-edit"; key: SortKey; how: SortEdit }
  | { type: "sort-set"; sort: Sort }

/** The text and caret after a hint is chosen: a key gets its `=`, a value replaces the piece being typed. */
export function acceptHint(text: string, slot: Slot, hint: Hint): { text: string; cursor: number } {
  const keyOnly = slot.key === undefined
  let insert = keyOnly ? `${hint.value}=` : hint.value
  // A value with a space is kept whole (and the hints stay on it) only in quotes, and a quote must open the
  // value. A comma is "or" even inside quotes, as in moai, so quoting does not save it.
  if (!keyOnly && /\s/.test(insert) && text[slot.from - 1] === "=") insert = `"${insert}"`
  const next = text.slice(0, slot.from) + insert + text.slice(slot.to)
  return { text: next, cursor: slot.from + insert.length }
}

/** The filter text without its `index`-th item (the item's span, up to where the next one starts). */
export function removeItem(text: string, index: number): string {
  const list = items(text)
  const item = list[index]
  if (!item) return text
  const next = list[index + 1]
  const head = text.slice(0, item.start).trimEnd()
  const tail = text.slice(next ? next.start : text.length).trimStart()
  return head && tail ? `${head} ${tail}` : head + tail
}

export function toolbarReduce(state: ToolbarState, action: ToolbarAction): ToolbarState {
  switch (action.type) {
    case "search-open":
      return { ...state, searchOpen: true }
    case "search-close":
      return { ...state, searchOpen: false, searchText: "" }
    case "search-text":
      return { ...state, searchOpen: true, searchText: action.text }
    case "scope-next":
      return { ...state, scope: nextScope(state.scope) }
    case "scope-prev":
      return { ...state, scope: prevScope(state.scope) }
    case "scope-set":
      return GREP_SCOPES.includes(action.scope) ? { ...state, scope: action.scope } : state
    case "filter-text":
      return { ...state, filterText: action.text, cursor: clamp(action.cursor, action.text.length), hintsOpen: true, hintIndex: -1 }
    case "filter-cursor":
      return { ...state, cursor: clamp(action.cursor, state.filterText.length), hintIndex: -1 }
    case "chip-remove": {
      const text = removeItem(state.filterText, action.index)
      return text === state.filterText ? state : { ...state, filterText: text, cursor: text.length, hintIndex: -1 }
    }
    case "hints-open":
      return { ...state, hintsOpen: true }
    case "hints-close":
      return { ...state, hintsOpen: false, hintIndex: -1 }
    case "hint-move": {
      if (action.count <= 0) return { ...state, hintIndex: -1 }
      const from = state.hintIndex < 0 ? (action.delta > 0 ? -1 : 0) : state.hintIndex
      return { ...state, hintsOpen: true, hintIndex: (from + action.delta + action.count) % action.count }
    }
    case "hint-accept": {
      const done = acceptHint(state.filterText, action.slot, action.hint)
      return { ...state, filterText: done.text, cursor: done.cursor, hintIndex: -1 }
    }
    case "sort-toggle":
      return { ...state, sortOpen: !state.sortOpen }
    case "sort-edit":
      return { ...state, sort: sortEdit(state.sort, action.key, action.how) }
    case "sort-set":
      return { ...state, sort: action.sort }
  }
}

const clamp = (n: number, max: number): number => Math.max(0, Math.min(n, max))

// ---- helpers over the data ------------------------------------------------------------------------------

/** `[from, to)` ranges of `q` in `text`, case-folded, non-overlapping; none when `q` is blank. */
export function highlightRanges(text: string, q: string): Array<[number, number]> {
  const needle = q.trim().toLowerCase()
  if (needle === "") return []
  const hay = text.toLowerCase()
  const out: Array<[number, number]> = []
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) out.push([at, at + needle.length])
  return out
}

/** `text` as nodes with the matched ranges wrapped in <mark>. */
export function highlight(doc: Document, text: string, q: string): Array<Node | string> {
  const out: Array<Node | string> = []
  let last = 0
  for (const [from, to] of highlightRanges(text, q)) {
    if (from > last) out.push(text.slice(last, from))
    out.push(el(doc, "mark", {}, text.slice(from, to)))
    last = to
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** The search result, and how many of the found rows the default list still hides, by the reason. */
export function searchView<T extends Row>(
  rows: readonly T[],
  state: Pick<ToolbarState, "searchText" | "scope">,
  filter: Filter,
  ctx: Context = {},
): { found: T[]; hidden: Partial<Record<HiddenReason, number>> } {
  const found = search(rows, state.searchText, state.scope, ctx)
  const hidden: Partial<Record<HiddenReason, number>> = {}
  if (state.searchText.trim() === "") return { found, hidden }
  const hiddenBy = hiding(filter, rows, ctx)
  for (const row of found) {
    const why = hiddenBy(row)
    // A row no one word opens is not counted, as in the CLI's tail.
    if (why && why !== "unopenable") hidden[why] = (hidden[why] ?? 0) + 1
  }
  return { found, hidden }
}

// ---- render ---------------------------------------------------------------------------------------------

export interface ToolbarDeps {
  doc: Document
  rows: readonly Row[]
  ctx?: Context
  lang?: Lang
}

export interface ToolbarHandlers {
  /** Every user act, as a reducer action. The caller reduces, stores and re-renders. */
  dispatch: (action: ToolbarAction) => void
}

export interface Toolbar {
  el: HTMLDivElement
  searchInput: HTMLInputElement
  filterInput: HTMLInputElement
  /** Rows the search finds (not yet cut by the filter) and the hidden-row counts behind the note. */
  found: Row[]
  hidden: Partial<Record<HiddenReason, number>>
}

export function renderToolbar(state: ToolbarState, deps: ToolbarDeps, handlers: ToolbarHandlers): Toolbar {
  const { doc } = deps
  const t = TOOLBAR_TEXT[deps.lang ?? "ko"]
  const { dispatch } = handlers
  const parsed = parseFilter(state.filterText)
  const filter = parsed.ok ? parsed.value : undefined
  const root = el(doc, "div", { class: "m-toolbar-stack", "data-toolbar": "" })

  // Search: opened by `/` (bound by the caller), applies as you type. Alt+ArrowDown / Alt+ArrowUp in the input
  // cycle the scope (the explorer's Tab / Shift-Tab order); the select sets it directly.
  const searchRow = el(doc, "div", { class: "m-toolbar", role: "search" })
  const box = searchBox(doc, {
    placeholder: t.searchPlaceholder,
    label: t.search,
    scopes: GREP_SCOPES.map((value) => ({ value, label: t.scopes[value] })),
    scopeLabel: t.scope,
    hint: "/",
  })
  box.input.value = state.searchText
  if (box.select) {
    box.select.value = state.scope
    box.select.addEventListener("change", () => dispatch({ type: "scope-set", scope: box.select!.value as GrepScope }))
  }
  box.input.addEventListener("input", () => dispatch({ type: "search-text", text: box.input.value }))
  box.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dispatch({ type: "search-close" })
    else if (event.key === "ArrowDown" && event.altKey) dispatch({ type: "scope-next" })
    else if (event.key === "ArrowUp" && event.altKey) dispatch({ type: "scope-prev" })
  })
  searchRow.append(box.el)
  searchRow.dataset.open = String(state.searchOpen)
  searchRow.hidden = !state.searchOpen

  // Filter text with the hint dropdown under it.
  const filterWrap = el(doc, "div", { class: "m-filter", style: "position:relative;flex:1 1 200px" })
  const filterInput = textInput(doc, { label: t.filter, placeholder: t.filterPlaceholder, invalid: !parsed.ok })
  filterInput.value = state.filterText
  const { slot, hints } = hintsAt(deps.rows, state.filterText, state.cursor, deps.ctx)
  const open = state.hintsOpen && hints.length > 0
  filterInput.addEventListener("input", () =>
    dispatch({ type: "filter-text", text: filterInput.value, cursor: filterInput.selectionStart ?? filterInput.value.length }),
  )
  filterInput.addEventListener("keyup", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    dispatch({ type: "filter-cursor", cursor: filterInput.selectionStart ?? 0 })
  })
  // A click moves the caret too; without this the hints stay on the item the keyboard last left.
  filterInput.addEventListener("click", () => dispatch({ type: "filter-cursor", cursor: filterInput.selectionStart ?? 0 }))
  filterInput.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      dispatch({ type: "hint-move", delta: event.key === "ArrowDown" ? 1 : -1, count: hints.length })
    } else if ((event.key === "Enter" || event.key === "Tab") && open && state.hintIndex >= 0) {
      event.preventDefault()
      dispatch({ type: "hint-accept", slot, hint: hints[state.hintIndex]! })
    } else if (event.key === "Escape") dispatch({ type: "hints-close" })
  })
  filterWrap.append(filterInput)
  if (open) {
    const list = menu(
      doc,
      hints.map((hint, index) => ({ id: String(index), label: hint.label ? `${hint.value}  ${hint.label}` : hint.value, hint: hint.count ? String(hint.count) : undefined })),
      (id) => dispatch({ type: "hint-accept", slot, hint: hints[Number(id)]! }),
    )
    list.setAttribute("aria-label", t.hints)
    list.classList.add("m-hints")
    list.style.cssText = "position:absolute;top:100%;left:0;right:0;z-index:20"
    list.querySelectorAll<HTMLElement>(".m-menu-item").forEach((node, index) => {
      if (index === state.hintIndex) node.setAttribute("aria-current", "true")
    })
    filterWrap.append(list)
  }

  // Sort badge and its edit popover.
  const badge = sortBadge(state.sort)
  const sortWrap = el(doc, "div", { class: "m-sort", style: "position:relative" })
  const label = badge.parts
    .map((part) => `${t.sortKeys[part.key]}${part.dir === "asc" ? "↑" : "↓"}`)
    .join(" ")
  const sortButton = button(doc, { label: `${t.sort}: ${label}${badge.reversed ? ` (${t.reversed})` : ""}`, icon: "arrow-up-down", small: true, onClick: () => dispatch({ type: "sort-toggle" }) })
  sortButton.setAttribute("aria-expanded", String(state.sortOpen))
  sortButton.dataset.sort = badge.text
  sortWrap.append(sortButton)
  if (state.sortOpen) {
    const pop = el(doc, "div", { class: "m-menu m-sort-pop", role: "dialog", "aria-label": t.sortEdit, style: "position:absolute;top:100%;right:0;z-index:20" })
    for (const key of SORT_KEYS) {
      const field = state.sort.fields.find((one) => one.key === key)
      const rowEl = el(doc, "div", { class: "m-menu-item", "data-key": key, style: "gap:4px" })
      rowEl.append(el(doc, "span", { style: "flex:1" }, `${t.sortKeys[key]}${field ? (field.dir === "asc" ? " ↑" : " ↓") : ""}`))
      for (const how of ["replace", "append", "flip"] as const) {
        const b = button(doc, { label: t[how], variant: "ghost", small: true, onClick: () => dispatch({ type: "sort-edit", key, how }) })
        b.dataset.how = how
        rowEl.append(b)
      }
      pop.append(rowEl)
    }
    sortWrap.append(pop)
  }

  const bar = el(doc, "div", { class: "m-toolbar" })
  bar.append(icon(doc, "filter", 14), filterWrap, sortWrap)
  if (!state.searchOpen) {
    bar.append(iconButton(doc, { icon: "search", label: t.search, onClick: () => dispatch({ type: "search-open" }) }))
  }

  // Chips of the parsed filter (comma is OR inside one chip, a repeated key is AND between chips).
  const chips = el(doc, "div", { class: "m-chips", style: "display:flex;flex-wrap:wrap;gap:4px;padding:0 8px" })
  items(state.filterText).forEach((item, index) => {
    if (item.text.trim() === "") return
    chips.append(chip(doc, { label: item.text, tone: parsed.ok ? "accent" : "neutral", removeLabel: t.removeChip, onRemove: () => dispatch({ type: "chip-remove", index }) }))
  })
  chips.hidden = chips.childElementCount === 0

  const error = parsed.ok ? null : el(doc, "div", { class: "m-banner m-banner-danger", role: "alert" }, badFilterMessage(parsed.error))

  // Search result and the note on rows the list still hides.
  const view = searchView(deps.rows, state, filter ?? parseOk(), deps.ctx)
  const reasons = (Object.keys(view.hidden) as HiddenReason[]).map((reason) => `${t.hiddenReasons[reason]} ${view.hidden[reason]}`)
  const note = reasons.length ? el(doc, "div", { class: "m-hidden-note", role: "status" }, `${t.hidden}: ${reasons.join(", ")}`) : null

  root.append(searchRow, bar, chips)
  if (error) root.append(error)
  if (note) root.append(note)
  return { el: root, searchInput: box.input, filterInput, found: view.found, hidden: view.hidden }
}

/** The empty filter (what the rows are held against while the typed one does not parse). */
function parseOk(): Filter {
  const parsed = parseFilter("")
  if (!parsed.ok) throw new Error("the empty filter always parses")
  return parsed.value
}
