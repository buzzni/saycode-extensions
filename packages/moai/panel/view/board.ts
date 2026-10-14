/**
 * The kanban: status columns (with Backlog and deferred in front), milestone lanes at the root, cards of up
 * to three lines. Which card goes where is board-groups.ts (on the IssueIndex's rules); this file draws it
 * with the shared components. It reads state and reports a click as `intents.choose`; moving a card
 * between columns is not part of 2.0.
 */
import { isDone, type IssueIndex, type Row } from '../data/index.js'
import type { State } from '../store.js'
import { BACKLOG, DEFERRED, groupBoard, type BoardLane } from './board-groups.ts'
import { segLabel } from './crumbs.ts'
import { chip, el, emptyState } from './components.ts'
import type { MountPane, PaneView, ViewContext } from './types.ts'

/** The same letters as the TUI, so a state is never told by colour alone. */
const GLYPHS: Record<string, string> = { todo: '·', in_progress: '▸', review: '?', done: '✓' }
export const glyphOf = (key: string): string => (key === BACKLOG ? '◇' : key === DEFERRED ? '⏸' : (GLYPHS[key] ?? '○'))

const priorityClass = (priority: number) => `m-p${Math.min(3, Math.max(0, Math.round(priority)))}`

function draw(ctx: ViewContext, state: State, index: IssueIndex): HTMLElement[] {
  const { document: doc, copy, intents } = ctx
  const model = groupBoard(index, { path: state.path, view: state.view, cursor: state.cursor })
  if (!model.total) return [emptyState(doc, { icon: 'kanban', title: copy.empty })]

  const nameOf = (key: string) =>
    key === BACKLOG ? copy.shell.backlog : key === DEFERRED ? copy.shell.deferred : ((copy.stats as Record<string, string>)[key] ?? key)

  const card = (at: number): HTMLElement => {
    const row: Row = index.rows[at]!
    const key = row.id
    const done = isDone(row)
    const selected = state.cursor === key
    const first = el(doc, 'div', { class: 'm-card-line' })
    first.append(el(doc, 'span', { class: 'm-id' }, row.id))
    if (typeof row.priority === 'number') first.append(' ', el(doc, 'span', { class: priorityClass(row.priority) }, `p${row.priority}`))
    if (index.isDir(at)) {
      const [d, w] = index.tally(index.dirPath(at))
      if (w) first.append(' ', el(doc, 'span', { class: 'm-count' }, `${d}/${w}`))
    }
    const lines: Node[] = [first, el(doc, 'div', { class: 'm-card-title' }, row.title ?? row.id)]
    const extras: Node[] = []
    if (state.columns.assignee && row.assignee) extras.push(chip(doc, { label: String(row.assignee) }))
    if (state.columns.epic) {
      const epic = index.epicOf(at)
      if (epic !== undefined) extras.push(chip(doc, { label: index.rows[index.find(epic) ?? -1]?.title ?? epic, tone: 'accent' }))
    }
    if (state.columns.tags) for (const tag of row.tags ?? []) extras.push(chip(doc, { label: `#${tag}` }))
    if (extras.length) lines.push(el(doc, 'div', { class: 'm-card-line' }, ...extras))
    const node = el(doc, 'div', {
      class: 'm-card', role: 'listitem', tabindex: selected ? 0 : -1, 'aria-selected': String(selected),
      'data-id': row.id, 'data-focus': `card:${row.id}`, title: row.title ?? row.id,
    }, ...lines)
    if (done) node.style.opacity = '0.75'
    node.addEventListener('click', () => intents.choose(row.id))
    node.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        intents.choose(row.id)
      }
    })
    return node
  }

  const laneHead = (lane: BoardLane): HTMLElement | null => {
    if (lane.seg === null) return null
    const title = lane.at !== undefined ? (index.rows[lane.at]!.title ?? index.rows[lane.at]!.id) : segLabel(lane.seg, index, copy)
    const head = el(doc, 'div', { class: 'm-lane-head', 'data-lane': lane.seg, style: 'position: static;' })
    head.append(el(doc, 'span', {}, title))
    return head
  }

  const out: HTMLElement[] = []
  for (const lane of model.lanes) {
    const head = laneHead(lane)
    if (head) out.push(head)
    const board = el(doc, 'div', { class: 'm-board', style: 'overflow: visible;', 'data-lane': lane.seg ?? '' })
    for (const column of lane.columns) {
      const label = nameOf(column.key)
      const lanes = el(doc, 'div', { class: 'm-lane', role: 'list', 'data-status': column.key, 'aria-label': copy.board.columnLabel(label, column.cards.length) })
      lanes.append(el(doc, 'div', { class: 'm-lane-head' },
        el(doc, 'span', { 'aria-hidden': 'true' }, glyphOf(column.key)), el(doc, 'span', {}, label), el(doc, 'span', { class: 'm-count' }, String(column.cards.length))))
      if (!column.cards.length) lanes.append(el(doc, 'div', { class: 'm-note', style: 'padding: 6px 10px; color: var(--muted);' }, copy.board.noCards))
      for (const at of column.cards) lanes.append(card(at))
      board.append(lanes)
    }
    out.push(board)
  }
  // Narrow panels scroll sideways instead of squeezing the columns below their minimum.
  const wrap = el(doc, 'div', { class: 'm-board-wrap', style: `min-width: ${model.keys.length * 200 + (model.keys.length - 1) * 2}px;` })
  wrap.append(...out)
  return [wrap]
}

export const mountBoard: MountPane = (root, ctx): PaneView => {
  const doc = ctx.document
  const pane = el(doc, 'div', { class: 'm-board-pane', 'aria-label': ctx.copy.board.label })
  root.replaceChildren(pane)
  let cursor: string | null = null
  return {
    render(state, index) {
      const active = doc.activeElement as HTMLElement | null
      const key = active && pane.contains(active) ? active.dataset?.focus : undefined
      pane.replaceChildren(...(index ? draw(ctx, state, index) : []))
      if (key !== undefined) {
        for (const node of pane.querySelectorAll<HTMLElement>('[data-focus]')) {
          if (node.dataset.focus === key) { node.focus({ preventScroll: true }); break }
        }
      }
      // The card with the cursor stays in view when the cursor moves.
      if (state.cursor !== cursor) {
        cursor = state.cursor
        const selected = pane.querySelector<HTMLElement>('.m-card[aria-selected="true"]')
        if (selected && typeof selected.scrollIntoView === 'function') selected.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      }
    },
    focus() {
      const target = pane.querySelector<HTMLElement>('.m-card[aria-selected="true"]') ?? pane.querySelector<HTMLElement>('.m-card')
      ;(target ?? (pane.closest('[tabindex]') as HTMLElement | null))?.focus({ preventScroll: false })
    },
    destroy() {
      pane.remove()
    },
  }
}
