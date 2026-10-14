import assert from 'node:assert/strict'
import { test } from 'node:test'

import { panelModule } from './moai-panel-modules.mjs'

const { COLUMN_DEFAULTS, createStore, detailPosition, initialState, keepCursor, reduce } = await panelModule('store.ts')
const { FORCE_BOTTOM_BELOW } = await panelModule('view/responsive.ts')
const { MAX_RATIO, MIN_RATIO } = await panelModule('view/split.ts')

test('the panel starts on the list with the TUI defaults', () => {
  const state = initialState()
  assert.equal(state.tab, 'list')
  assert.deepEqual(state.path, [])
  assert.equal(state.cursor, null)
  assert.deepEqual(state.detail, { visible: true, position: 'bottom', ratio: { left: 0.45, bottom: 0.3 } })
  assert.equal(state.view.hideDeferred, true)
  assert.deepEqual(state.sort, [{ field: 'priority', descending: false }])
  assert.deepEqual(Object.entries(state.columns).filter(([, on]) => on).map(([name]) => name), ['id', 'priority', 'counts', 'header'])
  assert.deepEqual(COLUMN_DEFAULTS.tags, false)
})

test('an action that changes nothing keeps the same state, so nothing re-renders', () => {
  const state = initialState()
  assert.equal(reduce(state, { type: 'tab', tab: 'list' }), state)
  assert.equal(reduce(state, { type: 'cursor', id: null }), state)
  assert.equal(reduce(state, { type: 'focus', focus: 'list' }), state)
})

test('the detail ratio is kept per position and clamped to 15–85%', () => {
  let state = reduce(initialState(), { type: 'detail-ratio', ratio: 0.95 })
  assert.equal(state.detail.ratio.bottom, MAX_RATIO)
  state = reduce(state, { type: 'detail-position', position: 'left' })
  state = reduce(state, { type: 'detail-ratio', ratio: 0.01 })
  assert.deepEqual(state.detail.ratio, { left: MIN_RATIO, bottom: MAX_RATIO })
  // An unusable ratio falls back to that position's own default.
  assert.equal(reduce(state, { type: 'detail-ratio', ratio: Number.NaN }).detail.ratio.left, 0.45)
  // A narrow panel shows the bottom whatever was chosen; the split says so, and that ratio is the one that moves.
  state = reduce(state, { type: 'detail-ratio', ratio: 0.5, position: 'bottom' })
  assert.deepEqual(state.detail.ratio, { left: MIN_RATIO, bottom: 0.5 })
})

test('below 640px the detail stands at the bottom whatever was chosen', () => {
  const detail = { visible: true, position: 'left', ratio: { left: 0.45, bottom: 0.3 } }
  assert.equal(detailPosition(detail, FORCE_BOTTOM_BELOW - 1), 'bottom')
  assert.equal(detailPosition(detail, FORCE_BOTTOM_BELOW), 'left')
})

test('hiding the detail moves the focus back to the list', () => {
  let state = reduce(initialState(), { type: 'focus', focus: 'detail' })
  state = reduce(state, { type: 'detail-visible', visible: false })
  assert.equal(state.focus, 'list')
  assert.equal(state.detail.visible, false)
})

test('a column turned off stays known and off; an empty sort falls back to priority', () => {
  let state = reduce(initialState(), { type: 'column', column: 'id', on: false })
  assert.equal(state.columns.id, false)
  assert.ok(state.columnsKnown.includes('id'))
  state = reduce(state, { type: 'sort', sort: [] })
  assert.deepEqual(state.sort, [{ field: 'priority', descending: false }])
})

test('folders unfold and fold by path', () => {
  let state = reduce(initialState(), { type: 'toggle-expanded', path: ['m:r1', 'e:e1'] })
  assert.equal(state.expanded.length, 1)
  state = reduce(state, { type: 'toggle-expanded', path: ['m:r1', 'e:e1'] })
  assert.deepEqual(state.expanded, [])
})

test('after a reload the cursor stays on its id, or moves to the nearest row still there', () => {
  assert.equal(keepCursor('b', ['a', 'b', 'c'], new Set(['a', 'b', 'c'])), 'b')
  assert.equal(keepCursor('b', ['a', 'b', 'c'], new Set(['a', 'c'])), 'c')
  assert.equal(keepCursor('c', ['a', 'b', 'c'], new Set(['a'])), 'a')
  assert.equal(keepCursor('b', ['a', 'b', 'c'], new Set()), null)
  assert.equal(keepCursor('z', ['a'], new Set(['a'])), null)
  assert.equal(keepCursor(null, ['a'], new Set(['a'])), null)
})

test('a reload keeps the rows read before on screen when it fails', () => {
  let state = reduce(initialState(), { type: 'board-loaded', data: { rows: [{ id: 'a' }, { id: 'b' }], more: 0, loadedAt: 1 } })
  state = reduce(state, { type: 'cursor', id: 'b' })
  state = reduce(state, { type: 'board-loading' })
  assert.equal(state.board.loading, true)
  state = reduce(state, { type: 'board-failed', problem: { kind: 'refused', code: 'declined' } })
  assert.deepEqual(state.board.value.rows.map((row) => row.id), ['a', 'b'])
  assert.deepEqual(state.board.problem, { kind: 'refused', code: 'declined' })
  state = reduce(state, { type: 'board-loaded', data: { rows: [{ id: 'a' }], more: 0, loadedAt: 2 }, order: ['b', 'a'] })
  assert.equal(state.cursor, 'a')
  assert.equal(state.board.problem, null)
})

test('a detail for another row does not show the previous one while it loads', () => {
  let state = reduce(initialState(), { type: 'detail-loaded', data: { id: 'a', row: { id: 'a' } } })
  assert.equal(reduce(state, { type: 'detail-loading', id: 'a' }).shown.value.id, 'a')
  state = reduce(state, { type: 'detail-loading', id: 'b' })
  assert.equal(state.shown.value, null)
  assert.equal(state.shown.loading, true)
})

test('the store notifies subscribers with the new and the previous state', () => {
  const store = createStore()
  const seen = []
  const stop = store.subscribe((state, previous) => seen.push([previous.tab, state.tab]))
  store.dispatch({ type: 'tab', tab: 'board' })
  store.dispatch({ type: 'tab', tab: 'board' })
  stop()
  store.dispatch({ type: 'tab', tab: 'wiki' })
  assert.deepEqual(seen, [['list', 'board']])
  assert.equal(store.getState().tab, 'wiki')
})
