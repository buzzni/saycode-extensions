/**
 * Stopgap pane views until E3 (se-c10x) lands view/list.ts, view/board.ts and view/detail.ts: they obey the
 * pane contract (view/types.ts), so each is replaced on its own by naming the new view in view/panes.ts.
 * - `mountList`: one listing level of the index — `..`, folders, rows — with the cursor row selected.
 * - `mountBoard`: the same list under a note; the kanban comes with E3.
 * - `mountDetail`: the row under the cursor — fields, body, subtasks and history.
 * They only render state and report intents; every decision lives in the store and the data layer.
 */
import type { IssueIndex, Row } from '../data/index.js'
import type { State } from '../store.js'
import { segLabel } from './crumbs.ts'
import type { MountPane, PaneView, ViewContext } from './types.ts'

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const element = doc.createElement(tag)
  if (className) element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

function button(doc: Document, className: string, text: string, onClick: () => void): HTMLButtonElement {
  const element = node(doc, 'button', className, text)
  element.type = 'button'
  element.addEventListener('click', onClick)
  return element
}

const STYLE_ID = 'moai-interim-style'
const STYLE = `
.moai-pane { display: flex; flex-direction: column; gap: 8px; padding: 8px 12px 12px; }
.moai-pane button { height: 28px; padding: 0 10px; font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); border-radius: 6px; cursor: pointer; }
.moai-list { margin: 0; padding: 0; list-style: none; border: 1px solid var(--border); border-radius: 6px; }
.moai-list li + li { border-top: 1px solid var(--border); }
.moai-list button { display: flex; gap: 8px; width: 100%; height: auto; min-height: 30px; text-align: left; border: 0; border-radius: 0; }
.moai-list button[aria-selected="true"] { background: var(--selected); }
.moai-list .moai-id, .moai-list .moai-count, .moai-list .moai-priority { color: var(--muted); font-variant-numeric: tabular-nums; }
.moai-list .moai-title { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.moai-empty, .moai-note { margin: 0; color: var(--muted); }
.moai-detail h2 { margin: 0 0 8px; font-size: 14px; overflow-wrap: anywhere; }
.moai-detail h3 { margin: 12px 0 4px; font-size: 12px; color: var(--muted); }
.moai-detail dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 2px 12px; margin: 0; }
.moai-detail dt { color: var(--muted); }
.moai-detail dd { margin: 0; overflow-wrap: anywhere; }
.moai-detail ul, .moai-detail ol { margin: 0; padding-left: 18px; }
.moai-detail ol li { display: flex; flex-wrap: wrap; gap: 2px 10px; }
.moai-detail .moai-close { float: right; }
.moai-journal-meta { color: var(--muted); }
.moai-body { margin: 8px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; }
`

/** The stopgap views' look, once per document. */
function styled(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return
  const style = node(doc, 'style')
  style.id = STYLE_ID
  style.textContent = STYLE
  doc.head.append(style)
}

/** Puts new children in place, keeping the keyboard focus on the element that stands for the same thing. */
function rebuild(doc: Document, container: HTMLElement, children: Node[]) {
  // Not `instanceof HTMLElement`: the document may come from another realm (the tests' jsdom).
  const active = doc.activeElement as HTMLElement | null
  const key = active && container.contains(active) ? active.dataset?.focus : undefined
  container.replaceChildren(...children)
  if (key === undefined) return
  for (const element of container.querySelectorAll<HTMLElement>('[data-focus]')) {
    if (element.dataset.focus !== key) continue
    element.focus({ preventScroll: true })
    return
  }
}

/** `element`, with the key that brings the focus back to it after a redraw. */
const focusable = <T extends HTMLElement>(key: string, element: T): T => {
  element.dataset.focus = key
  return element
}

/** One listing level of the index into `list`; shared by the list and the stopgap board. */
function listing(ctx: ViewContext, list: HTMLUListElement) {
  const { document: doc, copy, intents } = ctx
  const priorityText = (row: Row) => (typeof row.priority === 'number' ? `p${row.priority}` : '')
  return (state: State, index: IssueIndex | null) => {
    if (!index) return list.replaceChildren()
    const path = state.path
    const hidden = new Set(state.view.hiddenStatuses)
    const keep = (at: number) => {
      const row = index.rows[at]!
      if (hidden.has(String(row.status))) return false
      return !(state.view.hideDeferred && index.shelvedAt(at) !== undefined)
    }
    const items: HTMLLIElement[] = []
    if (path.length) {
      const up = node(doc, 'li')
      up.append(focusable('up', button(doc, 'moai-up', copy.up, () => intents.enter(path.slice(0, -1)))))
      items.push(up)
    }
    for (const entry of index.entries(path, keep)) {
      const item = node(doc, 'li')
      if (entry.dir && entry.at === undefined) {
        item.append(focusable(`seg:${entry.seg}`, button(doc, 'moai-row moai-bucket', `▸ ${segLabel(entry.seg, index, copy)}/`, () => intents.enter([...path, entry.seg]))))
        items.push(item)
        continue
      }
      const at = entry.at!
      const row = index.rows[at]!
      const line = focusable(`row:${row.id}`, node(doc, 'button', 'moai-row'))
      line.type = 'button'
      line.dataset.id = row.id
      line.setAttribute('aria-selected', String(state.cursor === row.id))
      const title = node(doc, 'span', 'moai-title', `${entry.dir ? '▸ ' : ''}${row.title ?? row.id}${entry.dir ? '/' : ''}`)
      line.append(node(doc, 'span', 'moai-id', row.id), node(doc, 'span', 'moai-priority', priorityText(row)), title)
      if (entry.dir) {
        const [done, work] = index.tally(index.dirPath(at))
        if (work) line.append(node(doc, 'span', 'moai-count', `${done}/${work}`))
      }
      line.addEventListener('click', () => intents.choose(row.id))
      if (entry.dir) line.addEventListener('dblclick', () => intents.enter(index.dirPath(at)))
      item.append(line)
      items.push(item)
    }
    if (!items.length || (items.length === 1 && path.length)) items.push(node(doc, 'li', 'moai-empty', copy.empty))
    // Every read and every choice redraws the list; the row that had the keyboard keeps it.
    rebuild(doc, list, items)
  }
}

/** The row under the cursor, else the first row: where the keyboard goes when the list is focused. */
function focusRow(list: HTMLElement) {
  const row = list.querySelector<HTMLElement>('button[aria-selected="true"]') ?? list.querySelector<HTMLElement>('button')
  row?.focus({ preventScroll: false })
}

export const mountList: MountPane = (root, ctx) => {
  styled(ctx.document)
  const pane = node(ctx.document, 'div', 'moai-pane')
  const list = node(ctx.document, 'ul', 'moai-list')
  list.setAttribute('aria-label', ctx.copy.list.label)
  pane.append(list)
  root.replaceChildren(pane)
  const draw = listing(ctx, list)
  return { render: draw, focus: () => focusRow(list) }
}

export const mountBoard: MountPane = (root, ctx) => {
  styled(ctx.document)
  const pane = node(ctx.document, 'div', 'moai-pane')
  const list = node(ctx.document, 'ul', 'moai-list')
  list.setAttribute('aria-label', ctx.copy.board.label)
  pane.append(node(ctx.document, 'p', 'moai-note', ctx.copy.board.interimNote), list)
  root.replaceChildren(pane)
  const draw = listing(ctx, list)
  return { render: draw, focus: () => focusRow(list) }
}

export const mountDetail: MountPane = (root, ctx): PaneView => {
  const { document: doc, copy, language, intents } = ctx
  styled(doc)
  const pane = node(doc, 'div', 'moai-pane')
  const none = node(doc, 'p', 'moai-empty moai-detail-none', copy.detail.none)
  const detail = node(doc, 'section', 'moai-detail')
  detail.setAttribute('aria-label', copy.detail.label)
  pane.append(none, detail)
  root.replaceChildren(pane)

  const dateText = (value: unknown) => {
    const date = new Date(typeof value === 'string' ? value : NaN)
    return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(language)
  }

  function journalText(entry: Record<string, unknown>): string {
    if (entry.kind === 'create') return copy.createdEntry
    if (entry.kind === 'note' && typeof entry.text === 'string') return entry.text
    if (entry.kind === 'status') return `${copy.stats[String(entry.from)] ?? entry.from} → ${copy.stats[String(entry.to)] ?? entry.to}`
    return String(entry.text ?? entry.kind ?? '')
  }

  function render(state: State) {
    const shown = state.shown.value
    none.hidden = Boolean(shown || state.shown.loading)
    if (!shown && !state.shown.loading) {
      detail.hidden = true
      detail.replaceChildren()
      return
    }
    detail.hidden = false
    if (!shown) {
      detail.replaceChildren(node(doc, 'p', 'moai-empty', copy.loading))
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
    const meta = node(doc, 'dl')
    for (const [label, value] of fields) meta.append(node(doc, 'dt', '', label), node(doc, 'dd', '', value))
    const close = focusable('close', button(doc, 'moai-close', copy.closeDetail, () => intents.closeDetail()))
    const parts: Node[] = [close, node(doc, 'h2', '', String(row.title ?? row.id)), meta]
    if (typeof row.body === 'string' && row.body) parts.push(node(doc, 'p', 'moai-body', row.body))
    const children = (Array.isArray(row.children) ? row.children : []).filter((child): child is Row => typeof child?.id === 'string')
    const childList = node(doc, 'ul')
    if (children.length) for (const child of children) childList.append(node(doc, 'li', '', `${child.title ?? child.id} (${child.id})`))
    else childList.append(node(doc, 'li', 'moai-empty', copy.noChildren))
    parts.push(node(doc, 'h3', '', copy.children), childList)
    const journal = node(doc, 'ol')
    for (const entry of Array.isArray(row.journal) ? (row.journal as Record<string, unknown>[]) : []) {
      const item = node(doc, 'li')
      item.append(node(doc, 'span', 'moai-journal-text', journalText(entry)), node(doc, 'span', 'moai-journal-meta', [entry.by, dateText(entry.ts)].filter(Boolean).join(' · ')))
      journal.append(item)
    }
    parts.push(node(doc, 'h3', '', copy.journal), journal)
    rebuild(doc, detail, parts)
  }

  return { render, focus: () => detail.querySelector<HTMLElement>('button')?.focus() }
}
