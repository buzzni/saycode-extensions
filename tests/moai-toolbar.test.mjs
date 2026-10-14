// Moai panel toolbar: reducer, hint acceptance, chip removal, sort popover, rendering.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'
import { panelModule } from './moai-panel-modules.mjs'

const tb = await panelModule('view/toolbar.ts')
const dom = new JSDOM('<!doctype html><body></body>')
const doc = dom.window.document

const rows = [
  { id: 'a1', title: 'Fix Login bug', status: 'todo', tags: ['bug', 'ui'], priority: 1 },
  { id: 'a2', title: 'Write docs', status: 'in_progress', tags: ['docs'], priority: 2 },
  { id: 'a3', title: 'Old login thing', status: 'done', tags: ['bug'], priority: 2 },
]
const reduce = (state, ...actions) => actions.reduce((s, a) => tb.toolbarReduce(s, a), state)

test('search: open, type, cycle scope both ways, close clears', () => {
  let s = reduce(tb.initialToolbar(), { type: 'search-open' }, { type: 'search-text', text: 'log' })
  assert.equal(s.searchOpen, true)
  assert.equal(s.searchText, 'log')
  s = reduce(s, { type: 'scope-next' })
  assert.equal(s.scope, 'id')
  s = reduce(s, { type: 'scope-prev' }, { type: 'scope-prev' })
  assert.equal(s.scope, 'note')
  s = reduce(s, { type: 'scope-set', scope: 'tag' })
  assert.equal(s.scope, 'tag')
  s = reduce(s, { type: 'search-close' })
  assert.deepEqual([s.searchOpen, s.searchText], [false, ''])
})

test('highlight ranges are case-folded and non-overlapping', () => {
  assert.deepEqual(tb.highlightRanges('Fix Login bug LOGIN', 'login'), [[4, 9], [14, 19]])
  assert.deepEqual(tb.highlightRanges('abc', ' '), [])
})

test('hint acceptance: key gets =, value replaces the piece, quotes only when needed', () => {
  const key = tb.acceptHint('sta', { partial: 'sta', from: 0, to: 3 }, { value: 'status', count: 0 })
  assert.deepEqual(key, { text: 'status=', cursor: 7 })
  const value = tb.acceptHint('tag=bug,u', { key: 'tag', partial: 'u', from: 8, to: 9 }, { value: 'ui', count: 1 })
  assert.deepEqual(value, { text: 'tag=bug,ui', cursor: 10 })
  const spaced = tb.acceptHint('assignee=', { key: 'assignee', partial: '', from: 9, to: 9 }, { value: 'Ann Lee', count: 1 })
  assert.equal(spaced.text, 'assignee="Ann Lee"')
})

test('hint flow through the reducer', () => {
  let s = reduce(tb.initialToolbar(), { type: 'filter-text', text: 'status=', cursor: 7 })
  assert.equal(s.hintsOpen, true)
  s = reduce(s, { type: 'hint-move', delta: 1, count: 3 }, { type: 'hint-move', delta: 1, count: 3 })
  assert.equal(s.hintIndex, 1)
  s = reduce(s, { type: 'hint-move', delta: -1, count: 3 }, { type: 'hint-move', delta: -1, count: 3 })
  assert.equal(s.hintIndex, 2)
  const { slot, hints } = { slot: { key: 'status', partial: '', from: 7, to: 7 }, hints: [{ value: 'todo', count: 1 }] }
  s = reduce(s, { type: 'hint-accept', slot, hint: hints[0] })
  assert.deepEqual([s.filterText, s.cursor, s.hintIndex], ['status=todo', 11, -1])
})

test('chip removal drops one item, keeps the rest', () => {
  assert.equal(tb.removeItem('status=todo tag=bug,ui epic=e1', 1), 'status=todo epic=e1')
  assert.equal(tb.removeItem('status=todo', 0), '')
  const s = reduce({ ...tb.initialToolbar(), filterText: 'tag=a tag=b' }, { type: 'chip-remove', index: 0 })
  assert.equal(s.filterText, 'tag=b')
})

test('sort edit through the reducer: replace, append, flip, replace twice flips', () => {
  let s = reduce(tb.initialToolbar(), { type: 'sort-edit', key: 'updated', how: 'replace' })
  assert.equal(s.sort.fields.map((f) => f.key + ':' + f.dir).join(), 'updated:desc')
  s = reduce(s, { type: 'sort-edit', key: 'title', how: 'append' })
  assert.equal(s.sort.fields.length, 2)
  s = reduce(s, { type: 'sort-edit', key: 'title', how: 'flip' })
  assert.equal(s.sort.fields[1].dir, 'desc')
  s = reduce(s, { type: 'sort-toggle' })
  assert.equal(s.sortOpen, true)
})

test('render: chips, error, scope, hidden note, hints, sort popover', () => {
  const seen = []
  const handlers = { dispatch: (a) => seen.push(a) }
  const base = { ...tb.initialToolbar(), searchOpen: true, searchText: 'login', filterText: 'tag=bug,ui priority=1', cursor: 21 }
  const view = tb.renderToolbar(base, { doc, rows, lang: 'en' }, handlers)
  assert.equal(view.el.querySelectorAll('.m-chip').length, 2)
  assert.equal(view.searchInput.value, 'login')
  assert.equal(view.found.length, 2)
  assert.deepEqual(view.hidden, { done: 1 })
  assert.match(view.el.querySelector('.m-hidden-note').textContent, /done 1/)
  view.el.querySelector('.m-chip-x').click()
  assert.deepEqual(seen.pop(), { type: 'chip-remove', index: 0 })
  assert.equal(view.el.querySelector('.m-sort-pop'), null)

  const bad = tb.renderToolbar({ ...base, filterText: 'nope=1' }, { doc, rows }, handlers)
  assert.ok(bad.el.querySelector('[role=alert]').textContent.length > 0)
  assert.equal(bad.filterInput.getAttribute('aria-invalid'), 'true')

  const hinting = tb.renderToolbar({ ...base, filterText: 'status=', cursor: 7, hintsOpen: true }, { doc, rows, lang: 'en' }, handlers)
  const items = hinting.el.querySelectorAll('.m-hints .m-menu-item')
  assert.ok(items.length >= 2)
  items[0].click()
  assert.equal(seen.pop().type, 'hint-accept')

  const sorting = tb.renderToolbar({ ...base, sortOpen: true }, { doc, rows, lang: 'en' }, handlers)
  assert.equal(sorting.el.querySelectorAll('.m-sort-pop [data-key]').length, 7)
  sorting.el.querySelector('[data-key=title] [data-how=append]').click()
  assert.deepEqual(seen.pop(), { type: 'sort-edit', key: 'title', how: 'append' })
})
