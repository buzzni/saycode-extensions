// The panel's frame (design §1): the tab bar (board, list, wiki; the refresh time, the detail toggles), a
// slot for the toolbar, the path line, the banners, the add field, the run's activity, and under them the
// split holding the list or board beside the detail. The panes are filled by the views named in
// view/panes.ts through the contract in view/types.ts; the shell renders the panes that show on every store
// change, and moves the split to the panel's width as it changes.
//
// The shell reads and dispatches to the store; it does no I/O. Reads, adds and cancels are the caller's
// (main.ts) and arrive as ShellIntents.

import { INFO_REFUSALS, type Outcome } from "../data/client.ts"
import type { IssueIndex } from "../data/index.ts"
import { refreshTime } from "../data/refresh.ts"
import type { Copy } from "../i18n/index.ts"
import type { Focus, State, Store, Tab } from "../store.ts"
import { button, el, emptyState, iconButton } from "./components.ts"
import { mountCrumbs } from "./crumbs.ts"
import { COLUMN_DROPS, effectivePosition } from "./responsive.ts"
import { createPositionToggle, createSplit } from "./split.ts"
import { createTabs, panelDomId, tabDomId } from "./tabs.ts"
import type { PaneLayout, PaneView, Panes, ViewContext, ViewIntents } from "./types.ts"

export interface Activity {
  /** 'starting' while Desktop may show its confirmation, 'running' once the machine runs it. */
  phase: "idle" | "starting" | "running"
  cancellable: boolean
}

/** What the shell cannot do by dispatching: the reads and writes main.ts runs. */
export interface ShellIntents {
  refresh(): void
  /** Cursor on the row and its detail read. */
  choose(id: string): void
  add(title: string): void
  cancel(): void
}

export interface ShellOptions {
  document: Document
  store: Store
  copy: Copy
  language: string
  intents: ShellIntents
  panes: Panes
  /** The index of the state's rows; the caller builds it once per read. */
  index(state: State): IssueIndex | null
  activity(): Activity
}

export interface Shell {
  el: HTMLElement
  /** Draw everything from the store now. The shell also does this on every store change. */
  render(): void
  /** The activity line and Cancel alone: they are all that follows the request queue, so nothing else redraws for it. */
  activity(current: Activity): void
  /** One line under the add field: the added task, or why nothing was added. */
  say(text: string, problem?: boolean): void
  /** Why an add did nothing, on that same line. The banners belong to the reads and redraw with them. */
  refuse(outcome: Outcome): void
  /** The add field; the caller clears it after an add went through. */
  input: HTMLInputElement
  /**
   * Places other parts mount into: `toolbar` under the tab bar (view/toolbar.ts), `actions` at the end of the
   * tab bar (the help button). Both are empty and take no room until something is put in them.
   */
  slots: { toolbar: HTMLElement; actions: HTMLElement }
  /** The panel's width changed. A ResizeObserver on the shell calls this; tests call it by hand. */
  setWidth(width: number): void
  layout(): PaneLayout
  destroy(): void
}

/** What an outcome tells the user, and whether it is information (a choice, a retry) rather than an error. */
export function describe(outcome: Outcome, copy: Copy, doc: Document): { parts: (string | Node)[]; info: boolean } | null {
  switch (outcome.kind) {
    case "refused":
      return { parts: [copy.refused[outcome.code]], info: INFO_REFUSALS.has(outcome.code) }
    case "not-initialized":
      return { parts: [copy.notInitialized[0], el(doc, "code", {}, "moai init"), copy.notInitialized[1]], info: true }
    case "moai-error":
      return { parts: [copy.moaiError(outcome.message)], info: false }
    case "cancelled":
      return { parts: [outcome.mayContinue ? `${copy.cancelled} ${copy.mayContinue}` : copy.cancelled], info: true }
    case "unreadable":
      return { parts: [copy.unreadable], info: false }
    case "not-started":
      return { parts: [copy.notStarted], info: false }
    case "failed":
      return { parts: [copy.failed], info: false }
    case "passed":
      return null
  }
}

/** The main pane's width: all of it, less the detail's share when the detail stands on the left. */
export function mainWidth(width: number, position: PaneLayout["position"], detailVisible: boolean, leftRatio: number): number {
  return position === "left" && detailVisible ? width * (1 - leftRatio) : width
}

/** How many right-hand columns a list this wide drops; a pane re-renders when this changes. */
const columnBand = (width: number): number => COLUMN_DROPS.filter((entry) => width < entry.below).length

type Saved = Array<[HTMLElement, number, number]>
const scrollers = (root: HTMLElement): HTMLElement[] => [root, ...root.querySelectorAll<HTMLElement>("[data-keep-scroll]")]
const saveScroll = (root: HTMLElement): Saved => scrollers(root).map((node) => [node, node.scrollTop, node.scrollLeft])
function restoreScroll(saved: Saved | undefined): void {
  for (const [node, top, left] of saved ?? []) {
    if (!node.isConnected) continue
    node.scrollTop = top
    node.scrollLeft = left
  }
}

export function mountShell(root: HTMLElement, options: ShellOptions): Shell {
  const { document: doc, store, copy, language, intents } = options
  const win = doc.defaultView
  let state = store.getState()

  // An unmeasured frame (0 wide: not laid out yet) counts as wide until the observer reports a real width.
  const measure = (): number => root.getBoundingClientRect().width || win?.innerWidth || Infinity
  let width = measure()

  // ── tab bar ──
  const tabs = createTabs(doc, {
    selected: state.tab,
    labels: copy.shell.tabs,
    ariaLabel: copy.shell.tabsLabel,
    onSelect: (tab) => store.dispatch({ type: "tab", tab }),
  })
  const refresh = el(doc, "button", { type: "button", class: "m-refreshed moai-refresh" }, copy.shell.refreshNow)
  refresh.addEventListener("click", () => intents.refresh())
  const visibility = iconButton(doc, { icon: "eye", label: copy.shell.hideDetail, pressed: state.detail.visible })
  visibility.classList.add("moai-detail-toggle")
  visibility.addEventListener("click", () => store.dispatch({ type: "detail-visible", visible: !store.getState().detail.visible }))
  const position = createPositionToggle(doc, {
    position: effectivePosition(width, state.detail.position),
    width,
    onToggle: (next) => store.dispatch({ type: "detail-position", position: next }),
    labels: { toLeft: copy.shell.detailToLeft, toBottom: copy.shell.detailToBottom, forcedBottom: copy.shell.detailForcedBottom },
  })
  position.el.classList.add("moai-position-toggle")
  const actions = el(doc, "div", { class: "m-tabbar-slot" })
  const tabbar = el(doc, "div", { class: "m-tabbar" },
    tabs.el, el(doc, "div", { class: "m-tabbar-spacer" }),
    el(doc, "div", { class: "m-tabbar-actions" }, refresh, visibility, position.el, actions))

  // ── under the tab bar: toolbar slot, path line, activity, banners, add field ──
  const toolbar = el(doc, "div", { class: "m-toolbar-slot" })
  const crumbs = mountCrumbs(doc, copy, (path) => store.dispatch({ type: "enter", path }))
  const activityText = el(doc, "span", { class: "moai-activity", role: "status" })
  const cancel = button(doc, { label: copy.cancel, small: true, onClick: () => intents.cancel() })
  cancel.classList.add("moai-cancel")
  const status = el(doc, "div", { class: "m-shell-status" }, activityText, cancel)
  const hint = el(doc, "p", { class: "moai-hint" }, copy.hint)
  const notice = el(doc, "div", { class: "m-banner moai-notice", role: "status" })
  const error = el(doc, "div", { class: "m-banner m-banner-danger moai-error", role: "alert" })
  const more = el(doc, "p", { class: "moai-more" })
  const input = el(doc, "input", { type: "text", class: "m-input", "aria-label": copy.shell.addLabel, placeholder: copy.placeholder, autocomplete: "off", maxlength: 512 })
  const submit = () => intents.add(input.value)
  const addButton = button(doc, { label: copy.add, variant: "primary", small: true, onClick: submit })
  addButton.classList.add("moai-add-button")
  // The panel iframe has no allow-forms, so Enter is handled here — and not while an IME composes.
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) {
      event.preventDefault()
      submit()
    }
  })
  const add = el(doc, "div", { class: "m-addbar moai-add" }, input, addButton)
  const result = el(doc, "p", { class: "moai-result" })
  const notes = el(doc, "div", { class: "m-shell-notes" }, hint, notice, error, more, add, result)
  // The path, banners and add field belong to the list and board; the wiki tab brings its own head.
  const head = el(doc, "div", { class: "m-shell-head" }, crumbs.el, notes)

  // ── body: one panel for the list and board (they share the cursor, path and detail), one for the wiki ──
  const split = createSplit(doc, {
    position: state.detail.position,
    ratios: state.detail.ratio,
    detailVisible: state.detail.visible,
    labels: { resizer: copy.shell.resizer },
    onRatio: (at, ratio) => store.dispatch({ type: "detail-ratio", position: at, ratio }),
  })
  split.setWidth(width)
  const mainRoots: Record<"list" | "board", HTMLElement> = {
    list: el(doc, "div", { class: "m-pane-main", "data-pane": "list", tabindex: -1, hidden: state.tab !== "list" }),
    board: el(doc, "div", { class: "m-pane-main", "data-pane": "board", tabindex: -1, hidden: state.tab !== "board" }),
  }
  split.list.append(mainRoots.list, mainRoots.board)
  const detailRoot = el(doc, "div", { class: "m-pane-detail", tabindex: -1 })
  split.detail.append(detailRoot)
  // Both work tabs control this one panel; its label follows the tab shown.
  const work = el(doc, "div", { class: "m-tabpanel", role: "tabpanel", id: panelDomId("list"), hidden: state.tab === "wiki" }, split.el)
  tabs.el.querySelector(`#${tabDomId("board")}`)?.setAttribute("aria-controls", panelDomId("list"))
  const wiki = el(doc, "div", { class: "m-tabpanel m-pane-wiki", role: "tabpanel", id: panelDomId("wiki"), "aria-labelledby": tabDomId("wiki"), tabindex: -1, hidden: state.tab !== "wiki" })
  const body = el(doc, "div", { class: "m-body" }, work, wiki)

  // The activity line stays on every tab: the wiki's reads wait for the confirmation too.
  const shell = el(doc, "div", { class: "m-shell" }, tabbar, toolbar, head, status, body)
  root.replaceChildren(shell)

  // ── panes ──
  const layout = (): PaneLayout => {
    const current = store.getState().detail
    const shown = effectivePosition(width, current.position)
    return { width, position: shown, detailVisible: current.visible, mainWidth: mainWidth(width, shown, current.visible, split.ratio("left")) }
  }
  const viewIntents: ViewIntents = {
    enter: (path, cursor) => store.dispatch(cursor === undefined ? { type: "enter", path } : { type: "enter", path, cursor }),
    choose: (id) => intents.choose(id),
    point: (id) => store.dispatch({ type: "cursor", id }),
    closeDetail: () => store.dispatch({ type: "detail-closed" }),
    setDetailVisible: (visible) => store.dispatch({ type: "detail-visible", visible }),
    toggleExpanded: (path) => store.dispatch({ type: "toggle-expanded", path }),
    refresh: () => intents.refresh(),
    dispatch: (action) => store.dispatch(action),
  }
  const focusPane = (area: Focus) => {
    store.dispatch({ type: "focus", focus: area })
    const now = store.getState()
    if (area === "detail") return detailView.focus ? detailView.focus() : detailRoot.focus()
    if (now.tab === "wiki") return wikiView?.focus ? wikiView.focus() : wiki.focus()
    const view = mainViews[now.tab]
    return view.focus ? view.focus() : mainRoots[now.tab].focus()
  }
  const ctx: ViewContext = { document: doc, copy, language, intents: viewIntents, layout, focusPane }
  const mainViews: Record<"list" | "board", PaneView> = {
    list: options.panes.list(mainRoots.list, ctx),
    board: options.panes.board(mainRoots.board, ctx),
  }
  const detailView = options.panes.detail(detailRoot, ctx)
  const wikiView = options.panes.wiki?.(wiki, ctx) ?? null
  if (!wikiView) wiki.append(emptyState(doc, { icon: "book-open", title: copy.shell.wikiPlaceholder }))

  // ── tab switching: each tab keeps its scroll offsets (display:none drops them) ──
  const containers: Record<Tab, HTMLElement> = { list: mainRoots.list, board: mainRoots.board, wiki }
  const saved = new Map<Tab | "detail", Saved>()
  let shownTab: Tab = state.tab
  /** Show `tab`'s panes; returns the offsets to put back once they are drawn. */
  function showTab(tab: Tab): () => void {
    if (tab === shownTab) return () => {}
    const leaving = shownTab
    saved.set(leaving, saveScroll(containers[leaving]))
    if (tab === "wiki") saved.set("detail", saveScroll(split.detail))
    containers[leaving].hidden = true
    containers[tab].hidden = false
    work.hidden = tab === "wiki"
    head.hidden = tab === "wiki"
    shownTab = tab
    return () => {
      restoreScroll(saved.get(tab))
      if (leaving === "wiki") restoreScroll(saved.get("detail"))
    }
  }

  // ── drawing ──
  function showActivity(current: Activity) {
    activityText.textContent = current.phase === "starting" ? copy.starting : current.phase === "running" ? copy.running : ""
    cancel.hidden = !current.cancellable
    status.hidden = current.phase === "idle" && !current.cancellable
  }

  function explain(outcome: Outcome | null) {
    notice.replaceChildren()
    error.replaceChildren()
    const said = outcome ? describe(outcome, copy, doc) : null
    if (said) (said.info ? notice : error).append(...said.parts)
  }

  function paintLayout(current: State) {
    const detail = current.detail
    if (split.preferred() !== detail.position) split.setPosition(detail.position)
    for (const at of ["left", "bottom"] as const) if (split.ratio(at) !== detail.ratio[at]) split.setRatio(at, detail.ratio[at])
    split.setDetailVisible(detail.visible)
    position.update(split.position(), width)
    shell.dataset.position = split.position()
    const label = detail.visible ? copy.shell.hideDetail : copy.shell.showDetail
    visibility.setAttribute("aria-pressed", String(detail.visible))
    visibility.setAttribute("aria-label", label)
    visibility.title = label
  }

  let band = columnBand(layout().mainWidth)
  function render() {
    state = store.getState()
    const index = options.index(state)
    if (tabs.selected() !== state.tab) tabs.setSelected(state.tab)
    work.setAttribute("aria-labelledby", tabDomId(state.tab === "board" ? "board" : "list"))
    const putBack = showTab(state.tab)

    const loadedAt = state.board.value?.loadedAt
    const at = loadedAt === undefined ? null : refreshTime(loadedAt, language)
    refresh.textContent = at ? `↻ ${at}` : copy.shell.refreshNow
    refresh.title = at ? copy.refreshedAt(at) : copy.shell.refreshNow
    refresh.setAttribute("aria-label", refresh.title)
    refresh.disabled = state.board.loading
    paintLayout(state)
    band = columnBand(layout().mainWidth)

    showActivity(options.activity())
    hint.hidden = state.board.value !== null
    explain(state.shown.problem ?? state.board.problem)
    const hiddenRows = state.board.value?.more ?? 0
    more.textContent = hiddenRows > 0 ? copy.more(hiddenRows) : ""

    if (state.tab === "wiki") {
      wikiView?.render(state, index)
    } else {
      crumbs.render(state, index)
      mainViews[state.tab].render(state, index)
      if (state.detail.visible) detailView.render(state, index)
    }
    putBack()
  }

  function setWidth(next: number) {
    if (!(next > 0) || next === width) return
    width = next
    split.setWidth(width)
    position.update(split.position(), width)
    shell.dataset.position = split.position()
    // The list drops right-hand columns as it narrows; draw it again only when a breakpoint is crossed.
    const now = columnBand(layout().mainWidth)
    if (now === band) return
    band = now
    const current = store.getState()
    if (current.tab !== "wiki") mainViews[current.tab].render(current, options.index(current))
  }

  const observer = win && "ResizeObserver" in win ? new win.ResizeObserver((entries) => setWidth(entries[0]?.contentRect.width ?? 0)) : null
  const onResize = () => setWidth(measure())
  if (observer) observer.observe(root)
  else win?.addEventListener("resize", onResize)

  const unsubscribe = store.subscribe(render)
  render()

  return {
    el: shell,
    render,
    activity: showActivity,
    say(text, problem = false) {
      result.textContent = text
      result.className = problem ? "moai-result m-banner m-banner-danger" : "moai-result"
    },
    refuse(outcome) {
      const said = describe(outcome, copy, doc)
      result.replaceChildren(...(said?.parts ?? []))
      result.className = said && !said.info ? "moai-result m-banner m-banner-danger" : "moai-result m-banner"
    },
    input,
    slots: { toolbar, actions },
    setWidth,
    layout,
    destroy() {
      unsubscribe()
      observer?.disconnect()
      win?.removeEventListener("resize", onResize)
      split.destroy()
      mainViews.list.destroy?.()
      mainViews.board.destroy?.()
      detailView.destroy?.()
      wikiView?.destroy?.()
    },
  }
}
