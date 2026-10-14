/**
 * A plain view over the store until the 2.0 shell and views land (E2 se-qwkz, E3 se-c10x): a refresh
 * button with the time of the last read, the add field, banners, the path, one listing level of the index
 * and the detail of the row under the cursor. It only renders state and reports intents; every decision
 * lives in the store and the data layer.
 */
import type { Copy } from '../i18n/index.js'
import type { Outcome } from '../data/client.js'
import { INFO_REFUSALS } from '../data/client.js'
import { LOST, NO_MILESTONE, type IssueIndex, type Path, type Row } from '../data/index.js'
import type { State } from '../store.js'

export interface Intents {
  refresh(): void
  enter(path: Path): void
  choose(id: string): void
  closeDetail(): void
  add(title: string): void
  cancel(): void
}

export interface Activity {
  /** 'starting' while Desktop may show its confirmation, 'running' once the machine runs it. */
  phase: 'idle' | 'starting' | 'running'
  cancellable: boolean
}

export interface InterimView {
  render(state: State, index: IssueIndex | null, activity: Activity, refreshedAt: string | null): void
  /** The activity line and Cancel alone: they are all that follows the request queue, so nothing else redraws for it. */
  activity(current: Activity): void
  /** One line under the add field: the added task, or why nothing was added. */
  say(text: string, problem?: boolean): void
  /** Why an add did nothing, on that same line. The banners belong to the list and the detail and redraw with them. */
  refuse(outcome: Outcome): void
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const element = node('button', className, text)
  element.type = 'button'
  element.addEventListener('click', onClick)
  return element
}

const STYLE = `
/* tokens.css stops the body scrolling because the shell's panes scroll themselves. This view is one long column,
   so the page scrolls until the shell replaces it; otherwise rows and the detail below the fold are out of reach. */
body { overflow: auto; }
.moai { display: flex; flex-direction: column; gap: 10px; padding: 12px 16px 16px; }
.moai-bar, .moai-add { display: flex; align-items: center; gap: 8px; }
.moai-bar .moai-activity { flex: 1; min-width: 0; color: var(--muted); }
.moai button { height: 28px; padding: 0 10px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.moai button:disabled { opacity: .55; cursor: default; }
.moai input { flex: 1; min-width: 0; height: 28px; padding: 0 8px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; }
.moai .moai-primary { color: var(--accent-contrast); background: var(--accent); border-color: var(--accent); }
.moai-banner { margin: 0; padding: 8px 10px; border: 1px solid var(--border); border-radius: 6px; }
.moai-banner.danger { color: var(--danger); border-color: var(--danger); }
.moai-result { margin: 0; }
/* Nothing to say: no empty box. */
.moai-banner:empty, .moai-result:empty { display: none; }
.moai-crumbs { display: flex; flex-wrap: wrap; gap: 2px; }
.moai-crumbs button { border: 0; height: 22px; padding: 0 4px; color: var(--accent); }
.moai-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: 6px; }
.moai-list li + li { border-top: 1px solid var(--border); }
.moai-list button { display: flex; gap: 8px; width: 100%; height: auto; min-height: 30px; text-align: left; border: 0; border-radius: 0; }
.moai-list button[aria-selected="true"] { background: var(--selected); }
.moai-list .moai-id, .moai-list .moai-count, .moai-list .moai-priority { color: var(--muted); font-variant-numeric: tabular-nums; }
.moai-list .moai-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.moai-empty, .moai-more { margin: 0; color: var(--muted); }
.moai-detail { padding: 10px 12px; border: 1px solid var(--border); border-radius: 6px; }
.moai-detail h2 { margin: 0 0 8px; font-size: 14px; overflow-wrap: anywhere; }
.moai-detail h3 { margin: 12px 0 4px; font-size: 12px; color: var(--muted); }
.moai-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; }
.moai-detail dt { color: var(--muted); }
.moai-detail dd { margin: 0; overflow-wrap: anywhere; }
.moai-detail ul, .moai-detail ol { margin: 0; padding-left: 18px; }
.moai-detail ol li { display: flex; flex-wrap: wrap; gap: 2px 10px; }
.moai-journal-meta { color: var(--muted); }
.moai-body { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
`

export function mountInterim(root: HTMLElement, copy: Copy, language: string, intents: Intents): InterimView {
  const style = node('style')
  style.textContent = STYLE
  const app = node('div', 'moai')
  const hint = node('p', 'moai-empty', copy.hint)
  const refresh = button('moai-refresh', copy.refresh, () => intents.refresh())
  const activity = node('span', 'moai-activity')
  activity.setAttribute('role', 'status')
  const cancel = button('moai-cancel', copy.cancel, () => intents.cancel())
  const bar = node('div', 'moai-bar')
  bar.append(refresh, activity, cancel)

  const input = node('input')
  input.maxLength = 512
  input.autocomplete = 'off'
  input.placeholder = copy.placeholder
  const submit = () => intents.add(input.value)
  const addButton = button('moai-primary moai-add-button', copy.add, submit)
  // The panel iframe has no allow-forms, so Enter is handled here — and not while an IME composes.
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.isComposing) {
      event.preventDefault()
      submit()
    }
  })
  const add = node('div', 'moai-add')
  add.append(input, addButton)
  const result = node('p', 'moai-result')

  const notice = node('div', 'moai-banner moai-notice')
  notice.setAttribute('role', 'status')
  const error = node('div', 'moai-banner danger moai-error')
  error.setAttribute('role', 'alert')
  const crumbs = node('nav', 'moai-crumbs')
  const list = node('ul', 'moai-list')
  list.setAttribute('aria-label', copy.board)
  const footer = node('p', 'moai-more')
  const detail = node('section', 'moai-detail')
  app.append(hint, bar, add, result, notice, error, crumbs, list, footer, detail)
  root.replaceChildren(style, app)

  const priorityText = (row: Row) => (typeof row.priority === 'number' ? `p${row.priority}` : '')
  const dateText = (value: unknown) => {
    const date = new Date(typeof value === 'string' ? value : NaN)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language)
  }

  /** What an outcome tells the user, and whether it is information (a choice, a retry) rather than an error. */
  function describe(outcome: Outcome): { parts: (string | Node)[]; info: boolean } | null {
    switch (outcome.kind) {
      case 'refused':
        return { parts: [copy.refused[outcome.code]], info: INFO_REFUSALS.has(outcome.code) }
      case 'not-initialized':
        return { parts: [copy.notInitialized[0], node('code', '', 'moai init'), copy.notInitialized[1]], info: true }
      case 'moai-error':
        return { parts: [copy.moaiError(outcome.message)], info: false }
      case 'cancelled':
        return { parts: [outcome.mayContinue ? `${copy.cancelled} ${copy.mayContinue}` : copy.cancelled], info: true }
      case 'unreadable':
        return { parts: [copy.unreadable], info: false }
      case 'not-started':
        return { parts: [copy.notStarted], info: false }
      case 'failed':
        return { parts: [copy.failed], info: false }
      case 'passed':
        return null
    }
  }

  function explain(outcome: Outcome | null) {
    notice.replaceChildren()
    error.replaceChildren()
    const said = outcome ? describe(outcome) : null
    if (said) (said.info ? notice : error).append(...said.parts)
  }

  /** Puts new children in place, keeping the keyboard focus on the element that stands for the same thing. */
  function rebuild(container: HTMLElement, children: Node[]) {
    const active = document.activeElement
    const key = active instanceof HTMLElement && container.contains(active) ? active.dataset.focus : undefined
    container.replaceChildren(...children)
    if (key === undefined) return
    for (const element of container.querySelectorAll<HTMLElement>('[data-focus]')) {
      if (element.dataset.focus !== key) continue
      element.focus({ preventScroll: true })
      return
    }
  }

  function showActivity(current: Activity) {
    activity.textContent = current.phase === 'starting' ? copy.starting : current.phase === 'running' ? copy.running : ''
    cancel.hidden = !current.cancellable
  }

  function segLabel(index: IssueIndex, seg: string): string {
    if (seg === NO_MILESTONE) return copy.noMilestone
    if (seg === LOST) return copy.lost
    const at = index.find(seg.slice(2))
    return at === undefined ? seg.slice(2) : String(index.rows[at]!.title ?? seg.slice(2))
  }

  /** `button`, with the key that brings the focus back to it after a redraw. */
  const focusable = (key: string, element: HTMLButtonElement) => {
    element.dataset.focus = key
    return element
  }

  function renderList(state: State, index: IssueIndex) {
    const path = state.path
    rebuild(crumbs, [
      focusable('crumb:', button('', copy.root, () => intents.enter([]))),
      ...path.map((seg, n) => focusable(`crumb:${n}`, button('', segLabel(index, seg), () => intents.enter(path.slice(0, n + 1))))),
    ])
    const hidden = new Set(state.view.hiddenStatuses)
    const keep = (at: number) => {
      const row = index.rows[at]!
      if (hidden.has(String(row.status))) return false
      return !(state.view.hideDeferred && index.shelvedAt(at) !== undefined)
    }
    const items: HTMLLIElement[] = []
    if (path.length) {
      const up = node('li')
      up.append(focusable('up', button('moai-up', copy.up, () => intents.enter(path.slice(0, -1)))))
      items.push(up)
    }
    for (const entry of index.entries(path, keep)) {
      const item = node('li')
      if (entry.dir && entry.at === undefined) {
        item.append(focusable(`seg:${entry.seg}`, button('moai-row moai-bucket', `▸ ${segLabel(index, entry.seg)}/`, () => intents.enter([...path, entry.seg]))))
        items.push(item)
        continue
      }
      const at = entry.at!
      const row = index.rows[at]!
      const line = focusable(`row:${row.id}`, node('button', 'moai-row'))
      line.type = 'button'
      line.dataset.id = row.id
      line.setAttribute('aria-selected', String(state.cursor === row.id))
      const title = node('span', 'moai-title', `${entry.dir ? '▸ ' : ''}${row.title ?? row.id}${entry.dir ? '/' : ''}`)
      line.append(node('span', 'moai-id', row.id), node('span', 'moai-priority', priorityText(row)), title)
      if (entry.dir) {
        const [done, work] = index.tally(index.dirPath(at))
        if (work) line.append(node('span', 'moai-count', `${done}/${work}`))
      }
      line.addEventListener('click', () => intents.choose(row.id))
      if (entry.dir) line.addEventListener('dblclick', () => intents.enter(index.dirPath(at)))
      item.append(line)
      items.push(item)
    }
    if (!items.length || (items.length === 1 && path.length)) items.push(node('li', 'moai-empty', copy.empty))
    // Every read and every choice redraws the list; the row that had the keyboard keeps it.
    rebuild(list, items)
  }

  function journalText(entry: Record<string, unknown>): string {
    if (entry.kind === 'create') return copy.createdEntry
    if (entry.kind === 'note' && typeof entry.text === 'string') return entry.text
    if (entry.kind === 'status') return `${copy.stats[String(entry.from)] ?? entry.from} → ${copy.stats[String(entry.to)] ?? entry.to}`
    return String(entry.text ?? entry.kind ?? '')
  }

  function renderDetail(state: State) {
    const shown = state.shown.value
    if (!state.detail.visible || (!shown && !state.shown.loading)) {
      detail.hidden = true
      detail.replaceChildren()
      return
    }
    detail.hidden = false
    if (!shown) {
      detail.replaceChildren(node('p', 'moai-empty', copy.loading))
      return
    }
    const row = shown.row
    const fields: [string, string][] = (
      [
        [copy.fields.status, copy.stats[String(row.status)] ?? String(row.status ?? '')],
        [copy.fields.priority, typeof row.priority === 'number' ? `P${row.priority}` : ''],
        [copy.fields.assignee, String(row.assignee ?? '')],
        [copy.fields.created, dateText(row.created_at)],
        [copy.fields.id, row.id],
      ] as [string, string][]
    ).filter(([, value]) => value)
    const meta = node('dl')
    for (const [label, value] of fields) meta.append(node('dt', '', label), node('dd', '', value))
    const close = focusable('close', button('moai-close', copy.closeDetail, () => intents.closeDetail()))
    const parts: Node[] = [close, node('h2', '', String(row.title ?? row.id)), meta]
    if (typeof row.body === 'string' && row.body) parts.push(node('p', 'moai-body', row.body))
    const children = (Array.isArray(row.children) ? row.children : []).filter((child): child is Row => typeof child?.id === 'string')
    const childList = node('ul')
    if (children.length) for (const child of children) childList.append(node('li', '', `${child.title ?? child.id} (${child.id})`))
    else childList.append(node('li', 'moai-empty', copy.noChildren))
    parts.push(node('h3', '', copy.children), childList)
    const journal = node('ol')
    for (const entry of Array.isArray(row.journal) ? (row.journal as Record<string, unknown>[]) : []) {
      const item = node('li')
      item.append(node('span', 'moai-journal-text', journalText(entry)), node('span', 'moai-journal-meta', [entry.by, dateText(entry.ts)].filter(Boolean).join(' · ')))
      journal.append(item)
    }
    parts.push(node('h3', '', copy.journal), journal)
    rebuild(detail, parts)
  }

  return {
    render(state, index, current, refreshedAt) {
      refresh.textContent = refreshedAt ? `↻ ${refreshedAt}` : copy.refresh
      refresh.title = refreshedAt ? copy.refreshedAt(refreshedAt) : copy.refresh
      refresh.setAttribute('aria-label', refresh.title)
      refresh.disabled = state.board.loading
      showActivity(current)
      if (index) renderList(state, index)
      const more = state.board.value?.more ?? 0
      footer.textContent = more > 0 ? copy.more(more) : ''
      footer.hidden = more <= 0
      explain(state.shown.problem ?? state.board.problem)
      renderDetail(state)
    },
    activity: showActivity,
    say(text, problem = false) {
      result.textContent = text
      result.className = problem ? 'moai-result moai-banner danger' : 'moai-result'
    },
    refuse(outcome) {
      const said = describe(outcome)
      result.replaceChildren(...(said?.parts ?? []))
      result.className = said && !said.info ? 'moai-result moai-banner danger' : 'moai-result moai-banner'
    },
  }
}
