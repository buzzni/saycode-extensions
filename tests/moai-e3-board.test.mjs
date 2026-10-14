// Moai panel board (se-c10x.bym): the grouping into lanes and columns, and the kanban in a jsdom document.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

import { panelModule } from './moai-panel-modules.mjs'

const { groupBoard, columnOf, statusKeys, BACKLOG, DEFERRED } = await panelModule('view/board-groups.ts')
const { mountBoard, glyphOf } = await panelModule('view/board.ts')
const { IssueIndex, NO_MILESTONE } = await panelModule('data/index.ts')
const { initialState } = await panelModule('store.ts')
const { copyFor } = await panelModule('i18n/index.ts')

const ROWS = [
  { id: 'm1', kind: 'milestone', title: 'v1', status: 'todo' },
  { id: 'm2', kind: 'milestone', title: 'v2', status: 'todo' },
  { id: 'e1', kind: 'epic', title: 'Epic one', milestone: 'm1', status: 'todo' },
  { id: 'e2', kind: 'epic', title: 'Epic two', milestone: 'm2', status: 'todo' },
  { id: 'e1.a', kind: 'issue', title: 'A', epic: 'e1', derived_epic: 'e1', status: 'todo', priority: 2 },
  { id: 'e1.b', kind: 'issue', title: 'B', epic: 'e1', derived_epic: 'e1', status: 'in_progress', priority: 0, assignee: 'kim' },
  { id: 'e1.c', kind: 'issue', title: 'C', epic: 'e1', derived_epic: 'e1', status: 'done', priority: 1 },
  { id: 'e2.a', kind: 'issue', title: 'D', epic: 'e2', derived_epic: 'e2', status: 'blocked', priority: 1 },
  { id: 'e2.b', kind: 'issue', title: 'E', epic: 'e2', derived_epic: 'e2', status: 'todo', deferred_at: '2026-01-01' },
  { id: 'b1', kind: 'backlog', title: 'Idea', status: 'todo' },
]
const index = new IssueIndex(ROWS)
const look = (over = {}) => ({
  path: [],
  view: { hiddenStatuses: [], hideDeferred: false, hideBacklog: false, showArchived: false },
  cursor: null,
  ...over,
})
const ids = (model, lane, key) => model.lanes[lane].columns.find((c) => c.key === key).cards.map((at) => index.rows[at].id)

test('statusKeys: configured statuses first, unknown ones appended once', () => {
  assert.deepEqual(statusKeys(ROWS), ['todo', 'in_progress', 'review', 'done', 'blocked'])
  assert.deepEqual(statusKeys(ROWS, ['done', 'todo']), ['done', 'todo', 'in_progress', 'blocked'])
})

test('groupBoard: root has a lane per milestone, cards in priority order, groups are not cards', () => {
  const model = groupBoard(index, look())
  assert.deepEqual(model.keys, [BACKLOG, DEFERRED, 'todo', 'in_progress', 'review', 'done', 'blocked'])
  assert.deepEqual(model.lanes.map((lane) => lane.seg), ['m:m1', 'm:m2', NO_MILESTONE])
  assert.equal(model.lanes[0].at, 0)
  assert.deepEqual(ids(model, 0, 'todo'), ['e1.a'])
  assert.deepEqual(ids(model, 0, 'in_progress'), ['e1.b'])
  assert.deepEqual(ids(model, 1, 'blocked'), ['e2.a'])
  assert.deepEqual(ids(model, 1, DEFERRED), ['e2.b'])
  assert.deepEqual(ids(model, 2, BACKLOG), ['b1'])
  assert.equal(model.total, 6)
  assert.equal(columnOf(index, index.find('e2.b')), DEFERRED)
})

test('groupBoard: hidden statuses, deferred and backlog drop their columns; the cursor card keeps its own', () => {
  const view = { hiddenStatuses: ['done'], hideDeferred: true, hideBacklog: true, showArchived: false }
  const model = groupBoard(index, look({ view }))
  assert.ok(!model.keys.includes('done') && !model.keys.includes(DEFERRED) && !model.keys.includes(BACKLOG))
  assert.deepEqual(model.lanes.map((lane) => lane.seg), ['m:m1', 'm:m2'])
  assert.equal(model.total, 3)
  const kept = groupBoard(index, look({ view, cursor: 'e1.c' }))
  assert.ok(kept.keys.includes('done'))
  assert.deepEqual(ids(kept, 0, 'done'), ['e1.c'])
})

test('groupBoard: inside a place there is one lane holding what is under it', () => {
  const model = groupBoard(index, look({ path: index.pathOf('e1') }))
  assert.equal(model.lanes.length, 1)
  assert.equal(model.lanes[0].seg, null)
  assert.deepEqual(ids(model, 0, 'todo'), ['e1.a'])
  assert.equal(model.total, 3)
  assert.deepEqual(groupBoard(new IssueIndex([]), look()).lanes, [])
})

const mount = (state, rows = ROWS) => {
  const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>')
  const chosen = []
  const root = dom.window.document.getElementById('r')
  const ctx = {
    document: dom.window.document, copy: copyFor('en'), language: 'en',
    intents: { choose: (id) => chosen.push(id) }, layout: () => ({}), focusPane: () => {},
  }
  const view = mountBoard(root, ctx)
  view.render(state, new IssueIndex(rows))
  return { root, view, chosen, dom }
}

test('board view: columns, lanes, cards, cursor highlight and click', () => {
  const state = { ...initialState(), tab: 'board', cursor: 'e1.b' }
  const { root, chosen } = mount(state)
  const lanes = [...root.querySelectorAll('[data-lane]')].filter((n) => n.classList.contains('m-board'))
  assert.equal(lanes.length, 3)
  const status = root.querySelector('.m-board [data-status="in_progress"]')
  assert.equal(status.getAttribute('role'), 'list')
  assert.match(status.getAttribute('aria-label'), /In progress, 1 cards/)
  const card = status.querySelector('.m-card')
  assert.equal(card.dataset.id, 'e1.b')
  assert.equal(card.getAttribute('aria-selected'), 'true')
  assert.match(card.textContent, /e1\.b/)
  assert.match(card.textContent, /p0/)
  card.click()
  root.querySelector('[data-id="e1.a"]').click()
  assert.deepEqual(chosen, ['e1.b', 'e1.a'])
  // The deferred row is hidden by default (hideDeferred) and the backlog stands in the first column.
  assert.equal(root.querySelector('[data-id="e2.b"]'), null)
  assert.ok(root.querySelector('[data-status="backlog"] [data-id="b1"]'))
  assert.equal(glyphOf('done'), '✓')
})

test('board view: assignee chip only when the column is on; empty board says so', () => {
  const base = { ...initialState(), tab: 'board' }
  assert.doesNotMatch(mount(base).root.querySelector('[data-id="e1.b"]').textContent, /kim/)
  const on = { ...base, columns: { ...base.columns, assignee: true } }
  assert.match(mount(on).root.querySelector('[data-id="e1.b"]').textContent, /kim/)
  const empty = mount(base, [])
  assert.match(empty.root.textContent, /Nothing here/)
})
