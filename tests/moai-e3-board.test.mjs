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

test('groupBoard: the board is a layout of the list: done rows past the archive age go unless shown, cards follow the sort', () => {
  const old = new Date(Date.now() - 40 * 86_400_000).toISOString()
  const rows = [
    { id: 't1', kind: 'issue', title: 'banana', status: 'todo', priority: 1 },
    { id: 't2', kind: 'issue', title: 'Apple', status: 'todo', priority: 2 },
    { id: 't3', kind: 'issue', title: 'cherry', status: 'todo', priority: 0 },
    { id: 'd1', kind: 'issue', title: 'Old', status: 'done', priority: 2, status_since: old },
    { id: 'd2', kind: 'issue', title: 'Fresh', status: 'done', priority: 2, status_since: new Date().toISOString() },
  ]
  const idx = new IssueIndex(rows)
  const cards = (model, key) => model.lanes[0].columns.find((c) => c.key === key)?.cards.map((at) => idx.rows[at].id)
  const hidden = groupBoard(idx, look())
  assert.deepEqual(cards(hidden, 'done'), ['d2'], 'an archive candidate is not a card')
  const shown = groupBoard(idx, look({ view: { ...look().view, showArchived: true } }))
  assert.deepEqual(cards(shown, 'done'), ['d1', 'd2'])
  assert.deepEqual(cards(groupBoard(idx, look({ cursor: 'd1' })), 'done'), ['d1', 'd2'], 'the cursor card is kept')
  // Without sort keys: (priority, id). With the list's: its order, a title without regard to case.
  assert.deepEqual(cards(hidden, 'todo'), ['t3', 't1', 't2'])
  assert.deepEqual(cards(groupBoard(idx, look({ sort: [{ field: 'title', descending: false }] })), 'todo'), ['t2', 't1', 't3'])
})

test('groupBoard: a thought that is closed is not a card', () => {
  const rows = [
    { id: 'i1', kind: 'backlog', title: 'open idea', status: 'todo' },
    { id: 'i2', kind: 'backlog', title: 'closed idea', status: 'done' },
    { id: 't1', kind: 'issue', title: 'work', status: 'todo' },
  ]
  const idx = new IssueIndex(rows)
  const model = groupBoard(idx, look())
  const cards = model.lanes.flatMap((lane) => lane.columns.flatMap((column) => column.cards.map((at) => idx.rows[at].id)))
  assert.deepEqual(cards.sort(), ['i1', 't1'])
  assert.equal(model.total, 2)
})

test('groupBoard: a repository without milestones has one unnamed lane, not a `(no milestone)` bucket', () => {
  const rows = [
    { id: 't1', kind: 'issue', title: 'A', status: 'todo', priority: 2 },
    { id: 't2', kind: 'issue', title: 'B', status: 'in_progress', priority: 1 },
  ]
  const plain = groupBoard(new IssueIndex(rows), look())
  assert.deepEqual(plain.lanes.map((lane) => lane.seg), [null])
  assert.equal(plain.total, 2)
  // And the view draws no lane head for it (the board's own columns are the only heads).
  const view = mount({ ...initialState(), tab: 'board' }, rows)
  assert.equal(view.root.querySelector('.m-lane-head:not(.m-lane .m-lane-head)'), null)
  assert.equal(view.root.querySelectorAll('.m-lane-head').length, view.root.querySelectorAll('.m-lane').length, 'only column heads')
  // With milestones the bucket is a lane of its own, as before.
  const withMilestone = groupBoard(index, look())
  assert.ok(withMilestone.lanes.some((lane) => lane.seg === NO_MILESTONE))
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
  assert.match(status.getAttribute('aria-label'), /^In progress, 1 card$/)
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

test('board view: one card is always the tab stop, Space is left to the key layer, tags that are not a list are not drawn', () => {
  const tabbable = (root) => [...root.querySelectorAll('.m-card')].filter((card) => card.getAttribute('tabindex') === '0').map((card) => card.dataset.id)
  // No cursor (or a cursor that is not a card): the first card in the order drawn can be reached by Tab.
  const none = mount({ ...initialState(), tab: 'board', cursor: null })
  assert.equal(tabbable(none.root).length, 1)
  assert.equal(tabbable(none.root)[0], none.root.querySelector('.m-card').dataset.id)
  assert.deepEqual(tabbable(mount({ ...initialState(), tab: 'board', cursor: 'e1' }).root).length, 1, 'a cursor on a group is not a card')
  assert.deepEqual(tabbable(mount({ ...initialState(), tab: 'board', cursor: 'e1.b' }).root), ['e1.b'])

  // Enter chooses; Space is the SPC leader and stays unhandled so the key layer sees it.
  const { root, chosen, dom } = mount({ ...initialState(), tab: 'board', cursor: 'e1.b' })
  const card = root.querySelector('[data-id="e1.a"]')
  const space = new dom.window.KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true })
  card.dispatchEvent(space)
  assert.equal(space.defaultPrevented, false)
  const enter = new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  card.dispatchEvent(enter)
  assert.equal(enter.defaultPrevented, true)
  assert.deepEqual(chosen, ['e1.a'])

  // A `tags` that is a string or an object (not what the CLI writes) draws no chips and does not throw.
  const odd = ROWS.map((row) => (row.id === 'e1.a' ? { ...row, tags: 'bug' } : row.id === 'e1.b' ? { ...row, tags: { a: 1 } } : row))
  const withTags = mount({ ...initialState(), tab: 'board', columns: { ...initialState().columns, tags: true } }, odd)
  assert.doesNotMatch(withTags.root.querySelector('[data-id="e1.a"]').textContent, /#/)
})

test('board view: assignee chip only when the column is on; empty board says so', () => {
  const base = { ...initialState(), tab: 'board' }
  assert.doesNotMatch(mount(base).root.querySelector('[data-id="e1.b"]').textContent, /kim/)
  const on = { ...base, columns: { ...base.columns, assignee: true } }
  assert.match(mount(on).root.querySelector('[data-id="e1.b"]').textContent, /kim/)
  const empty = mount(base, [])
  assert.match(empty.root.textContent, /Nothing here/)
})
