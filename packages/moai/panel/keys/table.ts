// Key table: every Moai panel key as data (docs/moai-panel/keybindings.md §3). Pure — no DOM.
// The router (router.ts) reads it to turn keys into action ids; the SPC menu grid (view/menu.ts) and the help
// overlay (view/help.ts) are built from it, so what the menu shows and what a key does cannot drift apart.
//
// Key notation (one token per key press, tokens joined by a space for a sequence):
//   - a printable character is itself; Shift is already in the character ('G', '?', 'P')
//   - named keys: SPC Enter Esc Tab Backspace Up Down Left Right Home End PageUp PageDown Delete
//   - modifiers prefix the token in the order C- (Ctrl), A- (Alt), S- (Shift, named keys only): 'C-d', 'S-Tab', 'A-Backspace'
//   - sequences: 'g g', 'C-w w', 'SPC v l'
// Cmd/Meta combinations are never ours (they belong to the host), so they have no notation.
//
// Exports for the views:
//   menuLayer(path, ctx)          → the SPC menu layer at `path` (['SPC'] or ['SPC','v']): title + visible items,
//                                   each with key, label, kind ('toggle' keeps the menu open, 'action' closes it,
//                                   'layer' goes one level down) and a state label ([보임]/[숨김], [오름]/[내림], …).
//   helpSections(mode, ctx, platform) → grouped rows { label, keys } for the help overlay; `available` marks rows
//                                   that do something right now.
//   keyLabel(notation)            → how to print a key or sequence in a <kbd> ('C-d' → 'Ctrl-d', 'g g' → 'gg', 'Up' → '↑').
//   MENU_CONTROLS                 → Esc / SPC / Backspace inside the menu, for the menu's footer hint.
// Clicking a menu item is the router's press(item.key) — the same path as pressing it.

export type Platform = "mac" | "other"

/** The router's modes. The SPC menu is not a mode: it is a layer over browse and wiki (see `menu` in KEY_TABLE). */
export type Mode = "browse" | "prompt" | "sorter" | "wiki"
export type TableName = Mode | "menu"

/** Verdicts of keybindings.md §3. 제외 keys are simply absent. */
export type Verdict = "같음" | "확인" | "대체" | "변경" | "추가"

export type SortField = "priority" | "created" | "updated" | "status" | "assignee" | "title"
export type CellField = "id" | "priority" | "assignee" | "created" | "updated" | "counts" | "tags" | "epic" | "names"

/**
 * What the table needs to know about the panel right now. The caller (store) fills it; every field is optional and a
 * missing field reads as the panel's default (detail shown at the bottom, list focus, nothing hidden).
 */
export interface KeyContext {
  mode: Mode
  /** Selected tab. */
  tab?: "list" | "board" | "wiki"
  /** Focused pane. Browse: 'list' | 'detail'. Wiki: 'list' | 'page'. */
  focus?: "list" | "detail" | "page"
  /** Detail pane shown (SPC v d). Default true. */
  detail?: boolean
  detailAt?: "left" | "bottom"
  /** The panel is narrower than 640px and the detail is forced to the bottom: SPC o d does nothing. */
  detailAtLocked?: boolean
  /** Body shown as raw markdown (SPC v r). */
  raw?: boolean
  hidden?: { deferred?: boolean; backlog?: boolean; archived?: boolean; columns?: ReadonlyArray<boolean> }
  /** Status column names in order (labels of SPC v 1~9; columns beyond the list are not offered). */
  columns?: ReadonlyArray<string>
  sort?: ReadonlyArray<{ field: SortField; desc: boolean }>
  /** List columns shown (SPC c). A missing field reads as shown. */
  cells?: Partial<Record<CellField, boolean>>
}

export type StateId =
  | "shown" | "hidden" | "asc" | "desc" | "left" | "bottom" | "raw" | "rendered" | "list" | "board" | "wiki"

export const STATE_LABELS: Readonly<Record<StateId, string>> = {
  shown: "[보임]",
  hidden: "[숨김]",
  asc: "[↑ 오름]",
  desc: "[↓ 내림]",
  left: "[왼쪽]",
  bottom: "[아래]",
  raw: "[원문]",
  rendered: "[렌더링]",
  list: "[목록]",
  board: "[칸반]",
  wiki: "[위키]",
}

export type HelpGroupId =
  | "move" | "enter" | "focus" | "tab" | "search" | "read" | "other"
  | "view" | "sort" | "cell" | "option" | "menu" | "prompt" | "sorter" | "wiki"

export const HELP_GROUPS: ReadonlyArray<{ id: HelpGroupId; title: string }> = [
  { id: "move", title: "이동" },
  { id: "enter", title: "드나들기·펼침" },
  { id: "wiki", title: "위키" },
  { id: "focus", title: "패널 포커스" },
  { id: "tab", title: "화면 전환" },
  { id: "search", title: "검색·필터" },
  { id: "read", title: "읽음" },
  { id: "view", title: "보기 (SPC v)" },
  { id: "sort", title: "정렬 (SPC s)" },
  { id: "cell", title: "열 (SPC c)" },
  { id: "option", title: "옵션 (SPC o)" },
  { id: "other", title: "기타" },
  { id: "menu", title: "SPC 메뉴 안에서" },
  { id: "prompt", title: "검색·필터 입력" },
  { id: "sorter", title: "정렬 편집" },
]

export interface Binding {
  /** Action id the router dispatches (with `args`). The store performs it. */
  action: string
  args?: Readonly<Record<string, string | number>>
  /** Key sequences on every platform. */
  keys: ReadonlyArray<string>
  /** Extra sequences only on macOS (Ctrl-w: Linux/Windows lose it to the host's tab-close). */
  macKeys?: ReadonlyArray<string>
  /** Korean label for the help overlay and the menu. */
  label: string
  /** Label that depends on the context (status column names). Falls back to `label`. */
  labelFor?: (ctx: KeyContext) => string
  group: HelpGroupId
  /** Menu items only: 'toggle' keeps the SPC menu open after running, 'action' (default) closes it. */
  kind?: "toggle" | "action"
  /** A motion key: inside the SPC menu, when the layer has no item on it, it closes the menu and moves (menu.rs). */
  motion?: boolean
  /** Menu bindings only: the modes whose SPC menu carries the item. */
  modes?: ReadonlyArray<"browse" | "wiki">
  /** Available in this context. Unavailable items are hidden from the menu and their keys do nothing. */
  when?: (ctx: KeyContext) => boolean
  /** Current state for the menu's state label. */
  state?: (ctx: KeyContext) => StateId | null
  verdict?: Verdict
  /** false: left out of the help overlay (repeated rows such as SPC v 2~9). */
  help?: boolean
  /** Keys printed in the help overlay instead of `keys`. */
  helpKeys?: ReadonlyArray<string>
}

export interface Layer {
  /** Full prefix, e.g. 'SPC v'. */
  prefix: string
  title: string
  /** State shown on the layer's entry in the parent layer (SPC g shows the current tab). */
  state?: (ctx: KeyContext) => StateId | null
}

export type KeyTable = Readonly<Record<TableName, ReadonlyArray<Binding>>>

// ---------------------------------------------------------------- context readers

const detailShown = (c: KeyContext): boolean => c.detail !== false
const detailAt = (c: KeyContext): "left" | "bottom" => c.detailAt ?? "bottom"
const listFocus = (c: KeyContext): boolean => (c.focus ?? "list") === "list"
const shown = (hidden: boolean | undefined): StateId => (hidden ? "hidden" : "shown")

/** Focus moves: the wiki always has list | page side by side; browse needs the detail and only moves along its axis. */
function focusWhen(side: "next" | "prev" | "left" | "right" | "up" | "down"): (c: KeyContext) => boolean {
  return (c) => {
    if (c.mode === "wiki") return side === "next" || side === "prev" || side === "left" || side === "right"
    if (!detailShown(c)) return false
    if (side === "left" || side === "right") return detailAt(c) === "left"
    if (side === "up" || side === "down") return detailAt(c) === "bottom"
    return true
  }
}

// ---------------------------------------------------------------- browse (list / board / detail)

const MOTION: ReadonlyArray<Binding> = [
  { action: "move.down", keys: ["j", "Down"], label: "한 줄 아래", group: "move", motion: true },
  { action: "move.up", keys: ["k", "Up"], label: "한 줄 위", group: "move", motion: true },
  { action: "move.top", keys: ["g g", "Home"], label: "맨 위", group: "move", motion: true },
  { action: "move.bottom", keys: ["G", "End"], label: "맨 아래", group: "move", motion: true },
  { action: "move.halfDown", keys: ["C-d"], label: "반 페이지 아래로 (커서 그대로)", group: "move", motion: true, verdict: "확인" },
  { action: "move.halfUp", keys: ["C-u"], label: "반 페이지 위로 (커서 그대로)", group: "move", motion: true, verdict: "확인" },
  { action: "move.pageDown", keys: ["C-f", "PageDown"], label: "한 페이지 아래로", group: "move", motion: true, verdict: "확인" },
  { action: "move.pageUp", keys: ["C-b", "PageUp"], label: "한 페이지 위로", group: "move", motion: true, verdict: "확인" },
]

/** Ctrl-w window moves (vim). macOS only — keybindings.md §3.3 대체; SPC w is the key everywhere. */
const CTRL_W: ReadonlyArray<Binding> = [
  { action: "focus.next", keys: [], macKeys: ["C-w w", "C-w C-w"], label: "다음 패널", group: "focus", when: focusWhen("next"), verdict: "대체" },
  { action: "focus.prev", keys: [], macKeys: ["C-w W"], label: "이전 패널", group: "focus", when: focusWhen("prev"), verdict: "대체" },
  { action: "focus.left", keys: [], macKeys: ["C-w h", "C-w C-h"], label: "왼쪽 패널", group: "focus", when: focusWhen("left"), verdict: "대체" },
  { action: "focus.right", keys: [], macKeys: ["C-w l", "C-w C-l"], label: "오른쪽 패널", group: "focus", when: focusWhen("right"), verdict: "대체" },
  { action: "focus.up", keys: [], macKeys: ["C-w k", "C-w C-k"], label: "위 패널", group: "focus", when: focusWhen("up"), verdict: "대체" },
  { action: "focus.down", keys: [], macKeys: ["C-w j", "C-w C-j"], label: "아래 패널", group: "focus", when: focusWhen("down"), verdict: "대체" },
]

const BROWSE: ReadonlyArray<Binding> = [
  ...MOTION,
  { action: "enter", keys: ["Enter"], label: "들어가기 (잎 행이면 상세로)", group: "enter", when: listFocus },
  { action: "leave", keys: ["Backspace"], label: "한 층 나가기", group: "enter", when: listFocus },
  { action: "expand", keys: ["l", "Right"], label: "펼침 (칸반: 오른쪽 칸)", group: "enter", motion: true, when: listFocus },
  { action: "collapse", keys: ["h", "Left"], label: "접음 (칸반: 왼쪽 칸)", group: "enter", motion: true, when: listFocus },
  { action: "expandAll", keys: ["Tab"], label: "그룹 밑을 모두 펼침·접음", group: "enter", when: (c) => listFocus(c) && c.tab !== "board" },
  ...CTRL_W,
  { action: "search.open", keys: ["/"], label: "검색", group: "search" },
  { action: "clear", keys: ["Esc"], label: "걸린 검색·필터 해제", group: "search" },
  { action: "read", keys: ["r"], label: "커서 행 읽음", group: "read" },
  { action: "help", keys: ["?"], label: "단축키 도움말", group: "other", verdict: "추가" },
]

// ---------------------------------------------------------------- SPC menu (browse and wiki)

const BOTH = ["browse", "wiki"] as const
const BROWSE_ONLY = ["browse"] as const

const SORTS: ReadonlyArray<[string, SortField, string]> = [
  ["p", "priority", "우선순위"],
  ["c", "created", "생성일"],
  ["u", "updated", "수정일"],
  ["s", "status", "상태"],
  ["a", "assignee", "담당자"],
  ["t", "title", "제목"],
]

const CELLS: ReadonlyArray<[string, CellField, string]> = [
  ["i", "id", "id"],
  ["p", "priority", "우선순위"],
  ["a", "assignee", "담당자"],
  ["c", "created", "생성일"],
  ["u", "updated", "수정일"],
  ["n", "counts", "셈 (n/n)"],
  ["t", "tags", "태그"],
  ["e", "epic", "에픽"],
  ["h", "names", "이름줄"],
]

const columnBindings: Binding[] = Array.from({ length: 9 }, (_, i): Binding => ({
  action: "view.column",
  args: { index: i },
  keys: [`SPC v ${i + 1}`],
  label: `${i + 1}번째 칸`,
  labelFor: (c) => c.columns?.[i] ?? `${i + 1}번째 칸`,
  group: "view",
  kind: "toggle",
  modes: BROWSE_ONLY,
  when: (c) => i < (c.columns?.length ?? 0),
  state: (c) => shown(c.hidden?.columns?.[i]),
  help: i === 0,
  helpKeys: i === 0 ? ["SPC v 1~9"] : undefined,
}))

const sortBindings: Binding[] = SORTS.flatMap(([key, field, word]): Binding[] => [
  {
    action: "sort.set",
    args: { field },
    keys: [`SPC s ${key}`],
    label: word,
    group: "sort",
    kind: "toggle",
    modes: BROWSE_ONLY,
    // Only when the order is this one field: pressing again flips it (keys.rs Browse::state).
    state: (c) => {
      const only = c.sort?.length === 1 ? c.sort[0] : undefined
      return only && only.field === field ? (only.desc ? "desc" : "asc") : null
    },
  },
  {
    action: "sort.add",
    args: { field },
    keys: [`SPC s ${key.toUpperCase()}`],
    label: `${word} (끝에 추가)`,
    group: "sort",
    kind: "toggle",
    modes: BROWSE_ONLY,
    state: (c) => {
      const hit = c.sort?.find((s) => s.field === field)
      return hit ? (hit.desc ? "desc" : "asc") : null
    },
  },
])

const cellBindings: Binding[] = CELLS.map(([key, field, word]): Binding => ({
  action: "cell.toggle",
  args: { field },
  keys: [`SPC c ${key}`],
  label: word,
  group: "cell",
  kind: "toggle",
  modes: BROWSE_ONLY,
  state: (c) => shown(c.cells?.[field] === false),
}))

const focusMenu = (action: string, key: string, label: string, side: Parameters<typeof focusWhen>[0]): Binding => ({
  action,
  keys: [`SPC w ${key}`],
  label,
  group: "focus",
  modes: BOTH,
  when: focusWhen(side),
  verdict: "대체",
})

/** Every SPC binding. Order is menu order (like keys.rs: the table's order is the menu's order). */
const MENU: ReadonlyArray<Binding> = [
  { action: "search.open", keys: ["SPC /"], label: "검색", group: "search", modes: BROWSE_ONLY, help: false },
  { action: "filter.open", keys: ["SPC f"], label: "필터", group: "search", modes: BROWSE_ONLY },
  { action: "add.open", keys: ["SPC n"], label: "할 일 추가", group: "other", modes: BROWSE_ONLY, verdict: "변경" },
  { action: "tab.list", keys: ["SPC g l"], label: "목록", group: "tab", modes: BOTH },
  { action: "tab.board", keys: ["SPC g b"], label: "칸반", group: "tab", modes: BOTH },
  { action: "tab.wiki", keys: ["SPC g w"], label: "위키", group: "tab", modes: BOTH },
  { action: "view.deferred", keys: ["SPC v l"], label: "미룸", group: "view", kind: "toggle", modes: BROWSE_ONLY, state: (c) => shown(c.hidden?.deferred) },
  { action: "view.backlog", keys: ["SPC v b"], label: "backlog", group: "view", kind: "toggle", modes: BROWSE_ONLY, state: (c) => shown(c.hidden?.backlog) },
  { action: "view.archived", keys: ["SPC v o"], label: "아카이브", group: "view", kind: "toggle", modes: BROWSE_ONLY, state: (c) => shown(c.hidden?.archived) },
  { action: "view.all", keys: ["SPC v a"], label: "모두 보이기", group: "view", modes: BROWSE_ONLY },
  ...columnBindings,
  { action: "view.detail", keys: ["SPC v d"], label: "상세", group: "view", kind: "toggle", modes: BROWSE_ONLY, state: (c) => shown(!detailShown(c)) },
  {
    action: "view.raw",
    keys: ["SPC v r"],
    label: "원문·렌더링",
    group: "view",
    kind: "toggle",
    modes: BOTH,
    // The wiki body is markdown whether or not the issue detail is shown.
    when: (c) => c.mode === "wiki" || detailShown(c),
    state: (c) => (c.raw ? "raw" : "rendered"),
  },
  ...sortBindings,
  { action: "sort.edit", keys: ["SPC s e"], label: "정렬 편집…", group: "sort", modes: BROWSE_ONLY },
  ...cellBindings,
  { action: "read.all", keys: ["SPC m a"], label: "모두 읽음", group: "read", modes: BROWSE_ONLY },
  { action: "read.group", keys: ["SPC m g"], label: "그룹 읽음", group: "read", modes: BROWSE_ONLY },
  {
    action: "option.detailAt",
    keys: ["SPC o d"],
    label: "상세 위치 (왼쪽 ↔ 아래)",
    group: "option",
    kind: "toggle",
    modes: BROWSE_ONLY,
    when: (c) => detailShown(c) && !c.detailAtLocked,
    state: (c) => detailAt(c),
    verdict: "변경",
  },
  focusMenu("focus.next", "w", "다음 패널", "next"),
  focusMenu("focus.prev", "W", "이전 패널", "prev"),
  focusMenu("focus.left", "h", "왼쪽 패널", "left"),
  focusMenu("focus.down", "j", "아래 패널", "down"),
  focusMenu("focus.up", "k", "위 패널", "up"),
  focusMenu("focus.right", "l", "오른쪽 패널", "right"),
  { action: "help", keys: ["SPC ?"], label: "단축키 도움말", group: "other", modes: BOTH, verdict: "추가" },
]

export const ROOT_TITLE = "메뉴"

export const LAYERS: ReadonlyArray<Layer> = [
  { prefix: "SPC g", title: "이동", state: (c) => (c.mode === "wiki" ? "wiki" : c.tab === "board" ? "board" : c.tab ?? "list") },
  { prefix: "SPC v", title: "보기" },
  { prefix: "SPC s", title: "정렬" },
  { prefix: "SPC c", title: "열" },
  { prefix: "SPC m", title: "읽음" },
  { prefix: "SPC o", title: "옵션" },
  { prefix: "SPC w", title: "창" },
]

/** Keys the router handles itself while the SPC menu is open (menu.rs MENU + the opening key). */
export const MENU_CONTROLS: ReadonlyArray<Binding> = [
  { action: "menu.close", keys: ["Esc", "SPC"], label: "닫기", group: "menu" },
  { action: "menu.up", keys: ["Backspace"], label: "한 층 위로", group: "menu" },
]

// ---------------------------------------------------------------- prompt, sorter, wiki

const PROMPT: ReadonlyArray<Binding> = [
  { action: "prompt.apply", keys: ["Enter"], label: "적용 (필터 값 목록이 있으면 값 넣기)", group: "prompt" },
  { action: "prompt.cancel", keys: ["Esc"], label: "취소하고 열기 전 커서로", group: "prompt" },
  { action: "prompt.next", keys: ["Tab"], label: "검색 범위 순환 / 필터 자동완성", group: "prompt" },
  { action: "prompt.prev", keys: ["S-Tab"], label: "검색 범위 거꾸로 / 필터 자동완성 거꾸로", group: "prompt" },
  { action: "prompt.up", keys: ["Up"], label: "필터 값 후보 위", group: "prompt" },
  { action: "prompt.down", keys: ["Down"], label: "필터 값 후보 아래", group: "prompt" },
  { action: "prompt.clear", keys: ["C-u"], label: "입력 전체 지움", group: "prompt", verdict: "확인" },
  { action: "prompt.deleteWord", keys: ["A-Backspace"], macKeys: ["C-w"], label: "단어 지움", group: "prompt", verdict: "대체" },
]

const SORTER: ReadonlyArray<Binding> = [
  { action: "sorter.down", keys: ["j", "Down"], label: "아래로", group: "sorter" },
  { action: "sorter.up", keys: ["k", "Up"], label: "위로", group: "sorter" },
  { action: "sorter.lower", keys: ["J"], label: "순서 뒤로", group: "sorter" },
  { action: "sorter.raise", keys: ["K"], label: "순서 앞으로", group: "sorter" },
  { action: "sorter.toggle", keys: ["SPC"], label: "넣기·빼기", group: "sorter" },
  { action: "sorter.flip", keys: ["d"], label: "방향 반전", group: "sorter" },
  { action: "sorter.apply", keys: ["Enter"], label: "적용", group: "sorter" },
  { action: "sorter.default", keys: ["D"], label: "기본값으로 저장", group: "sorter" },
  { action: "sorter.cancel", keys: ["Esc"], label: "취소", group: "sorter" },
]

const WIKI: ReadonlyArray<Binding> = [
  ...MOTION,
  { action: "wiki.enter", keys: ["Enter"], label: "페이지 열기 / 링크 선택·이동", group: "wiki" },
  { action: "wiki.back", keys: ["Backspace", "h", "Left"], label: "건너온 길 되감기", group: "wiki" },
  { action: "wiki.nextLink", keys: ["Tab"], label: "다음 링크", group: "wiki" },
  { action: "wiki.prevLink", keys: ["S-Tab"], label: "이전 링크", group: "wiki" },
  { action: "wiki.search", keys: ["/"], label: "제목·본문 검색", group: "search" },
  { action: "wiki.clear", keys: ["Esc"], label: "링크 선택 해제 → 검색 해제", group: "wiki", verdict: "변경" },
  ...CTRL_W.filter((b) => b.action !== "focus.up" && b.action !== "focus.down"),
  { action: "help", keys: ["?"], label: "단축키 도움말", group: "other", verdict: "추가" },
]

export const KEY_TABLE: KeyTable = {
  browse: BROWSE,
  menu: MENU,
  prompt: PROMPT,
  sorter: SORTER,
  wiki: WIKI,
}

// ---------------------------------------------------------------- helpers

/** A sequence notation to its tokens: 'SPC v l' → ['SPC', 'v', 'l']. */
export function tokens(notation: string): string[] {
  return notation.split(" ").filter((t) => t !== "")
}

/** The binding's key sequences on this platform. */
export function bindingKeys(binding: Binding, platform: Platform): string[] {
  return platform === "mac" ? [...binding.keys, ...(binding.macKeys ?? [])] : [...binding.keys]
}

export function isAvailable(binding: Binding, ctx: KeyContext): boolean {
  if (binding.modes && !binding.modes.includes(ctx.mode as "browse" | "wiki")) return false
  return binding.when ? binding.when(ctx) : true
}

export function labelOf(binding: Binding, ctx: KeyContext): string {
  return binding.labelFor ? binding.labelFor(ctx) : binding.label
}

export function stateOf(binding: Binding, ctx: KeyContext): { id: StateId; label: string } | null {
  const id = binding.state?.(ctx) ?? null
  return id ? { id, label: STATE_LABELS[id] } : null
}

/** Bindings the router looks at in a mode: its own table, plus the SPC menu for browse and wiki. */
export function bindingsFor(mode: Mode, table: KeyTable = KEY_TABLE): Binding[] {
  const own = [...table[mode]]
  if (mode === "browse" || mode === "wiki") own.push(...table.menu.filter((b) => !b.modes || b.modes.includes(mode)))
  return own
}

const startsWith = (seq: ReadonlyArray<string>, prefix: ReadonlyArray<string>): boolean =>
  seq.length >= prefix.length && prefix.every((t, i) => seq[i] === t)

export type Lookup =
  | { kind: "run"; binding: Binding }
  | { kind: "pending" }
  | { kind: "unknown" }

/** keys.rs `lookup`: a longer sequence starting with `seq` → pending; an exact one → run; otherwise unknown. */
export function lookup(bindings: ReadonlyArray<Binding>, seq: ReadonlyArray<string>, platform: Platform): Lookup {
  let exact: Binding | undefined
  for (const binding of bindings) {
    for (const key of bindingKeys(binding, platform)) {
      const t = tokens(key)
      if (!startsWith(t, seq)) continue
      if (t.length > seq.length) return { kind: "pending" }
      exact ??= binding
    }
  }
  return exact ? { kind: "run", binding: exact } : { kind: "unknown" }
}

/** Some available binding lies under `prefix` (menu.rs `live`): only then is a layer offered or entered. */
export function live(bindings: ReadonlyArray<Binding>, prefix: ReadonlyArray<string>, ctx: KeyContext, platform: Platform): boolean {
  return bindings.some((b) => isAvailable(b, ctx) && bindingKeys(b, platform).some((k) => {
    const t = tokens(k)
    return t.length > prefix.length && startsWith(t, prefix)
  }))
}

export interface MenuItem {
  /** The key to press (or to pass to router.press on click). */
  key: string
  /** Item label; a layer item reads '+보기'. */
  label: string
  kind: "toggle" | "action" | "layer"
  state: { id: StateId; label: string } | null
  action?: string
  args?: Readonly<Record<string, string | number>>
}

export interface MenuLayer {
  path: string[]
  /** 'SPC v' */
  prefix: string
  /** '메뉴' at the root, the layer title below. */
  title: string
  items: MenuItem[]
  /** The layer has a toggle: it stays open after a toggle, so the footer should say "Esc 닫기". */
  waits: boolean
}

export function layerOf(prefix: string): Layer | undefined {
  return LAYERS.find((l) => l.prefix === prefix)
}

/**
 * The SPC menu layer at `path` (['SPC'] is the root) as it should be drawn now: only available items, in table order,
 * sub-layers only when something under them is available. Clicking an item = router.press(item.key).
 */
export function menuLayer(path: ReadonlyArray<string> | string, ctx: KeyContext, table: KeyTable = KEY_TABLE): MenuLayer {
  const at = typeof path === "string" ? tokens(path) : [...path]
  const prefix = at.join(" ")
  const bindings = table.menu.filter((b) => isAvailable(b, ctx))
  const items: MenuItem[] = []
  const seen = new Set<string>()
  for (const binding of bindings) {
    for (const key of binding.keys) {
      const t = tokens(key)
      if (t.length <= at.length || !startsWith(t, at)) continue
      const next = t[at.length]!
      if (seen.has(next)) continue
      seen.add(next)
      if (t.length === at.length + 1) {
        items.push({
          key: next,
          label: labelOf(binding, ctx),
          kind: binding.kind ?? "action",
          state: stateOf(binding, ctx),
          action: binding.action,
          args: binding.args,
        })
      } else {
        const sub = [...at, next].join(" ")
        const layer = layerOf(sub)
        const id = layer?.state?.(ctx) ?? null
        items.push({ key: next, label: `+${layer?.title ?? "…"}`, kind: "layer", state: id ? { id, label: STATE_LABELS[id] } : null })
      }
    }
  }
  return {
    path: at,
    prefix,
    title: at.length <= 1 ? ROOT_TITLE : layerOf(prefix)?.title ?? prefix,
    items,
    waits: items.some((i) => i.kind === "toggle"),
  }
}

export interface HelpRow {
  action: string
  args?: Readonly<Record<string, string | number>>
  label: string
  /** Key notations; print each with keyLabel(). */
  keys: string[]
  /** Does something in this context right now. */
  available: boolean
}

export interface HelpSection {
  id: HelpGroupId
  title: string
  rows: HelpRow[]
}

/** The help overlay for a mode: rows grouped by HELP_GROUPS order, platform keys only, empty groups left out. */
export function helpSections(mode: Mode, ctx: KeyContext, platform: Platform, table: KeyTable = KEY_TABLE): HelpSection[] {
  const bindings: Binding[] = [...table[mode]]
  if (mode === "browse" || mode === "wiki") {
    bindings.push(...table.menu.filter((b) => !b.modes || b.modes.includes(mode)), ...MENU_CONTROLS)
  }
  const sections: HelpSection[] = []
  for (const group of HELP_GROUPS) {
    const rows: HelpRow[] = []
    for (const binding of bindings) {
      if (binding.group !== group.id || binding.help === false) continue
      const keys = binding.helpKeys ? [...binding.helpKeys] : bindingKeys(binding, platform)
      if (keys.length === 0) continue
      // One row per action: the SPC w and Ctrl-w forms of a focus move share a row.
      const same = rows.find((r) => r.action === binding.action && JSON.stringify(r.args) === JSON.stringify(binding.args))
      const available = binding.group === "menu" || isAvailable(binding, { ...ctx, mode })
      if (same) {
        same.keys.push(...keys)
        same.available ||= available
        continue
      }
      rows.push({ action: binding.action, args: binding.args, label: labelOf(binding, ctx), keys, available })
    }
    if (rows.length > 0) sections.push({ id: group.id, title: group.title, rows })
  }
  return sections
}

const KEY_NAMES: Readonly<Record<string, string>> = {
  Up: "↑",
  Down: "↓",
  Left: "←",
  Right: "→",
  Backspace: "Bksp",
  PageUp: "PgUp",
  PageDown: "PgDn",
}

/** A key or sequence for a <kbd>: 'C-d' → 'Ctrl-d', 'S-Tab' → 'Shift-Tab', 'g g' → 'gg', 'Up' → '↑', 'SPC w w' stays. */
export function keyLabel(notation: string): string {
  if (notation === "g g") return "gg"
  return tokens(notation)
    .map((token) => {
      const m = /^((?:[CAS]-)*)(.+)$/.exec(token)!
      const mods = m[1]!.replace(/C-/g, "Ctrl-").replace(/A-/g, "Alt-").replace(/S-/g, "Shift-")
      return mods + (KEY_NAMES[m[2]!] ?? m[2]!)
    })
    .join(" ")
}
