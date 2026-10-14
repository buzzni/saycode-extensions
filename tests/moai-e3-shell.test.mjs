// Moai panel shell assembly (se-qwkz.2v9): the path line, what the panel remembers, and the shell itself —
// tabs, the detail toggles and the split wired to the store — in a jsdom document.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

import { panelModule } from './moai-panel-modules.mjs'

const { crumbSegments, crumbLine, hungBadge, lookBadge, segLabel, sortWords } = await panelModule('view/crumbs.ts')
const { MEMORY_KEY, createMemory, normalizeMemory, remember } = await panelModule('data/memory.ts')
const { createStore, initialState, reduce } = await panelModule('store.ts')
const { IssueIndex, LOST, NO_MILESTONE } = await panelModule('data/index.ts')
const { copyFor } = await panelModule('i18n/index.ts')
const { mountShell, mainWidth } = await panelModule('view/shell.ts')
const { PANES } = await panelModule('view/panes.ts')

const en = copyFor('en')
const ko = copyFor('ko')

const ROWS = [
  { id: 'se-m1', kind: 'milestone', title: 'v2.0', status: 'todo' },
  { id: 'se-e1', kind: 'epic', title: 'E3 views', milestone: 'se-m1', status: 'todo' },
  { id: 'se-e1.a', kind: 'issue', title: 'List', epic: 'se-e1', derived_epic: 'se-e1', status: 'todo', priority: 1 },
  { id: 'se-e1.b', kind: 'issue', title: 'Board', epic: 'se-e1', derived_epic: 'se-e1', status: 'in_progress', priority: 2 },
]
const index = new IssueIndex(ROWS)

test('crumbs: the path reads as titles from the root, each segment going to its level', () => {
  const path = index.pathOf('se-e1')
  assert.deepEqual(path, ['m:se-m1', 'e:se-e1'])
  assert.deepEqual(crumbSegments(path, index, en), [
    { label: '/', path: [] },
    { label: 'v2.0', path: ['m:se-m1'] },
    { label: 'E3 views', path: ['m:se-m1', 'e:se-e1'] },
  ])
  assert.deepEqual(crumbSegments([], index, en), [{ label: '/', path: [] }])
  // Buckets have names of their own; a row the index does not hold (not read yet) shows its id.
  assert.equal(segLabel(NO_MILESTONE, index, ko), '(마일스톤 없음)')
  assert.equal(segLabel(LOST, index, en), '(lost)')
  assert.equal(segLabel('e:se-gone', index, en), 'se-gone')
  assert.equal(segLabel('m:se-m1', null, en), 'se-m1')
})

test('crumbs: hidden and sort badges only when the view hides something or the order is not the default', () => {
  const state = initialState()
  // The TUI starts with deferred rows hidden, and says so.
  assert.equal(lookBadge(state, en), 'deferred hidden')
  assert.equal(lookBadge({ ...state, view: { ...state.view, hideDeferred: false } }, en), null)
  const busy = {
    view: { hiddenStatuses: ['done'], hideDeferred: true, hideBacklog: true, showArchived: false },
    sort: [{ field: 'priority', descending: false }, { field: 'updated', descending: true }],
  }
  assert.equal(lookBadge(busy, en), 'done · deferred · backlog hidden · sort priority↑, updated↓')
  assert.equal(lookBadge(busy, ko), 'done · 미룸 · 백로그 숨김 · 정렬 우선순위↑, 고친 날↓')
  assert.equal(sortWords([{ field: 'title', descending: false }], en), 'title↑')
})

test('crumbs: a search or filter that is on is a badge of its own; the filter wins', () => {
  assert.equal(hungBadge({ search: '' }), null)
  assert.equal(hungBadge({ search: 'grid' }), '/grid')
  assert.equal(hungBadge({ search: 'grid', filter: 'status=todo' }), 'status=todo')
  assert.equal(hungBadge({ search: '', filter: '   ' }), null)
  const line = crumbLine({ ...initialState(), path: ['m:se-m1'], search: 'x' }, index, en)
  assert.deepEqual(line.segments.map((segment) => segment.label), ['/', 'v2.0'])
  assert.equal(line.hung, '/x')
})

test('memory: whatever storage gives back becomes usable settings', () => {
  const defaults = { tab: 'list', detail: { visible: true, position: 'bottom', ratio: { left: 0.45, bottom: 0.3 } } }
  for (const junk of [null, undefined, 3, 'list', [], { tab: 7, detail: 'left' }]) assert.deepEqual(normalizeMemory(junk), defaults)
  assert.deepEqual(
    normalizeMemory({ version: 1, tab: 'board', detail: { visible: false, position: 'left', ratio: { left: 0.6, bottom: 0.2 } } }),
    { tab: 'board', detail: { visible: false, position: 'left', ratio: { left: 0.6, bottom: 0.2 } } },
  )
  // Out of range ratios are clamped, unknown tabs and positions (the TUI's right/top) fall back.
  assert.deepEqual(
    normalizeMemory({ tab: 'stats', detail: { visible: 'yes', position: 'right', ratio: { left: 2, bottom: -1 } } }),
    { tab: 'list', detail: { visible: true, position: 'bottom', ratio: { left: 0.85, bottom: 0.15 } } },
  )
  assert.deepEqual(normalizeMemory({ detail: { ratio: { left: Number.NaN } } }).detail.ratio, { left: 0.45, bottom: 0.3 })
})

const fakeStorage = () => {
  const items = new Map()
  return { items, getItem: (key) => (items.has(key) ? items.get(key) : null), setItem: (key, value) => items.set(key, String(value)) }
}

test('memory: kept in storage when it works, for the session when it throws', () => {
  const storage = fakeStorage()
  const memory = createMemory(() => storage)
  assert.equal(memory.persistent, true)
  const settings = { tab: 'wiki', detail: { visible: true, position: 'left', ratio: { left: 0.5, bottom: 0.3 } } }
  memory.save(settings)
  assert.equal(JSON.parse(storage.items.get(MEMORY_KEY)).version, 1)
  assert.deepEqual(createMemory(() => storage).load(), settings)

  // An opaque-origin frame throws on reading window.localStorage itself.
  const blocked = createMemory(() => { throw new Error('SecurityError') })
  assert.equal(blocked.persistent, false)
  assert.equal(blocked.load().tab, 'list')
  blocked.save(settings)
  assert.deepEqual(blocked.load(), settings)

  // A storage that refuses writes (full, or blocked later) drops to the session copy.
  const refusing = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }
  const quota = createMemory(() => refusing)
  quota.save(settings)
  assert.equal(quota.persistent, false)
  assert.deepEqual(quota.load(), settings)

  storage.items.set(MEMORY_KEY, '{not json')
  assert.equal(createMemory(() => storage).load().tab, 'list')
})

test('memory: restored into the store at boot, saved only when a remembered setting changes', () => {
  const storage = fakeStorage()
  storage.items.set(MEMORY_KEY, JSON.stringify({ tab: 'board', detail: { visible: false, position: 'left', ratio: { left: 0.6, bottom: 0.25 } } }))
  let writes = 0
  const counting = { getItem: storage.getItem, setItem: (key, value) => { writes++; storage.setItem(key, value) } }
  const store = createStore()
  remember(store, createMemory(() => counting))
  const state = store.getState()
  assert.equal(state.tab, 'board')
  assert.deepEqual(state.detail, { visible: false, position: 'left', ratio: { left: 0.6, bottom: 0.25 } })
  assert.equal(writes, 0)
  store.dispatch({ type: 'search', text: 'x' })
  store.dispatch({ type: 'cursor', id: 'se-e1.a' })
  assert.equal(writes, 0, 'state the panel does not remember writes nothing')
  store.dispatch({ type: 'detail-ratio', position: 'bottom', ratio: 0.4 })
  assert.equal(writes, 1)
  assert.equal(JSON.parse(storage.items.get(MEMORY_KEY)).detail.ratio.bottom, 0.4)
})

test('store: restore applies what was kept and leaves the rest', () => {
  const state = initialState()
  assert.equal(reduce(state, { type: 'restore', settings: {} }), state)
  const restored = reduce({ ...state, focus: 'detail' }, { type: 'restore', settings: { detail: { visible: false, position: 'left', ratio: { left: 0.9, bottom: 0.3 } } } })
  assert.equal(restored.tab, 'list')
  assert.equal(restored.detail.ratio.left, 0.85)
  assert.equal(restored.focus, 'list', 'a hidden detail cannot hold the focus')
})

test('shell: the main pane is narrower only by a detail standing on the left', () => {
  assert.equal(mainWidth(1000, 'left', true, 0.4), 600)
  assert.equal(mainWidth(1000, 'left', false, 0.4), 1000)
  assert.equal(mainWidth(500, 'bottom', true, 0.4), 500)
})

/** Mounts the shell as main.ts does, in a fresh document, on `storage`. */
function boot(storage, { rows = ROWS } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en"><head></head><body><div id="moai-app"></div></body></html>', { pretendToBeVisual: true })
  const doc = dom.window.document
  const store = createStore()
  remember(store, createMemory(() => storage))
  const calls = []
  const rowIndex = new IssueIndex(rows)
  const shell = mountShell(doc.getElementById('moai-app'), {
    document: doc,
    store,
    copy: en,
    language: 'en',
    panes: PANES,
    index: (state) => (state.board.value ? rowIndex : null),
    activity: () => ({ phase: 'idle', cancellable: false }),
    intents: {
      refresh: () => calls.push(['refresh']),
      choose: (id) => { calls.push(['choose', id]); store.dispatch({ type: 'cursor', id }) },
      add: (title) => calls.push(['add', title]),
      cancel: () => calls.push(['cancel']),
    },
  })
  store.dispatch({ type: 'board-loaded', data: { rows, more: 0, loadedAt: Date.UTC(2026, 9, 14, 3, 4, 5) } })
  const $ = (selector) => doc.querySelector(selector)
  return { dom, doc, store, shell, calls, $, tab: (id) => $(`[role="tab"][data-tab="${id}"]`) }
}

test('shell: tabs switch the pane shown and the choice is remembered', () => {
  const storage = fakeStorage()
  const panel = boot(storage)
  assert.deepEqual([...panel.doc.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent), ['Board', 'List', 'Wiki'])
  assert.equal(panel.tab('list').getAttribute('aria-selected'), 'true')
  assert.equal(panel.$('.m-pane-main[data-pane="list"]').hidden, false)
  assert.equal(panel.$('.m-pane-main[data-pane="board"]').hidden, true)
  // Both work tabs control the one panel that holds the split.
  assert.equal(panel.tab('board').getAttribute('aria-controls'), panel.tab('list').getAttribute('aria-controls'))

  panel.tab('board').click()
  assert.equal(panel.store.getState().tab, 'board')
  assert.equal(panel.$('.m-pane-main[data-pane="list"]').hidden, true)
  assert.equal(panel.$('.m-pane-main[data-pane="board"]').hidden, false)
  assert.ok(panel.$('.m-pane-main[data-pane="board"] .m-board-pane .m-lane'), 'the board view drew its status columns')
  assert.equal(JSON.parse(storage.items.get(MEMORY_KEY)).tab, 'board')

  // The wiki tab: no path line or add field; a placeholder until the wiki view is named in panes.ts.
  panel.tab('wiki').click()
  assert.equal(panel.$('.m-shell-head').hidden, true)
  assert.equal(panel.$('#m-panel-wiki').hidden, false)
  assert.equal(panel.$('#m-panel-list').hidden, true)
  assert.equal(panel.$('#m-panel-wiki .m-empty-title').textContent, en.shell.wikiPlaceholder)

  // The tab bar's refresh time reads again.
  assert.match(panel.$('.moai-refresh').textContent, /^↻ \d{2}:\d{2}:\d{2}$/)
  panel.$('.moai-refresh').click()
  assert.deepEqual(panel.calls, [['refresh']])
})

test('shell: the position and visibility toggles are remembered and come back on the next boot', () => {
  const storage = fakeStorage()
  const panel = boot(storage)
  const toggle = panel.$('.moai-position-toggle')
  assert.equal(toggle.getAttribute('aria-label'), 'Move details to the left')
  assert.equal(panel.$('.m-split').dataset.position, 'bottom')
  toggle.click()
  assert.equal(panel.store.getState().detail.position, 'left')
  assert.equal(panel.$('.m-split').dataset.position, 'left')
  assert.equal(toggle.getAttribute('aria-label'), 'Move details to the bottom')
  assert.equal(panel.shell.layout().mainWidth, panel.shell.layout().width * (1 - 0.45))

  // The resizer's keys change the ratio of the position shown, and that is remembered too.
  panel.$('.m-split-resizer').dispatchEvent(new panel.dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
  const left = panel.store.getState().detail.ratio.left
  assert.equal(left.toFixed(4), '0.4700')

  const visibility = panel.$('.moai-detail-toggle')
  assert.equal(visibility.getAttribute('aria-pressed'), 'true')
  visibility.click()
  assert.equal(panel.$('.m-split').dataset.detail, 'hidden')
  assert.equal(visibility.getAttribute('aria-label'), 'Show details')
  panel.tab('board').click()

  assert.deepEqual(JSON.parse(storage.items.get(MEMORY_KEY)), { version: 1, tab: 'board', detail: { visible: false, position: 'left', ratio: { left, bottom: 0.3 } } })

  const again = boot(storage)
  assert.equal(again.tab('board').getAttribute('aria-selected'), 'true')
  assert.equal(again.$('.m-pane-main[data-pane="board"]').hidden, false)
  assert.equal(again.$('.m-split').dataset.position, 'left')
  assert.equal(again.$('.m-split').dataset.detail, 'hidden')
  assert.equal(again.$('.m-split').style.getPropertyValue('--m-detail-size'), '47.00%')
})

test('shell: a narrow panel forces the detail to the bottom without forgetting the choice', () => {
  const storage = fakeStorage()
  storage.items.set(MEMORY_KEY, JSON.stringify({ detail: { position: 'left' } }))
  const panel = boot(storage)
  assert.equal(panel.$('.m-split').dataset.position, 'left')
  panel.shell.setWidth(500)
  const toggle = panel.$('.moai-position-toggle')
  assert.equal(panel.$('.m-split').dataset.position, 'bottom')
  assert.equal(toggle.getAttribute('aria-disabled'), 'true')
  assert.equal(toggle.title, en.shell.detailForcedBottom)
  toggle.click()
  assert.equal(panel.store.getState().detail.position, 'left', 'the disabled toggle changes nothing')
  assert.deepEqual(panel.shell.layout(), { width: 500, mainWidth: 500, position: 'bottom', detailVisible: true })
  panel.shell.setWidth(900)
  assert.equal(panel.$('.m-split').dataset.position, 'left')
})

test('shell: the path line goes where its segments point, and the list follows', () => {
  const panel = boot(fakeStorage())
  const rows = () => [...panel.doc.querySelectorAll('.m-pane-main[data-pane="list"] .moai-line[data-id]')].map((row) => row.dataset.id)
  assert.deepEqual([...panel.doc.querySelectorAll('.m-crumb')].map((crumb) => crumb.textContent), ['/'])
  panel.store.dispatch({ type: 'enter', path: ['m:se-m1', 'e:se-e1'] })
  assert.deepEqual([...panel.doc.querySelectorAll('.m-crumb')].map((crumb) => crumb.textContent), ['/', 'v2.0', 'E3 views'])
  assert.equal(panel.$('.m-crumb[aria-current="location"]').textContent, 'E3 views')
  assert.equal(rows().length, 2)
  assert.equal(panel.doc.querySelectorAll('.moai-line').length, 3, 'the `..` line is a line without an id')
  panel.doc.querySelectorAll('.m-crumb')[1].click()
  assert.deepEqual(panel.store.getState().path, ['m:se-m1'])
  panel.$('.m-crumb').click()
  assert.deepEqual(panel.store.getState().path, [])
  // The badge says why rows are missing; a search on adds its own with the way out.
  assert.equal(panel.$('.m-crumbs-badges').textContent, 'deferred hidden')
  panel.store.dispatch({ type: 'search', text: 'grid' })
  assert.match(panel.$('.m-crumbs-badges').textContent, /\/grid.*Esc clears it/)
})

test('shell: choosing a row reads its detail through the shell intents; the add field reports through say', () => {
  const panel = boot(fakeStorage())
  panel.store.dispatch({ type: 'enter', path: ['m:se-m1', 'e:se-e1'] })
  const row = [...panel.doc.querySelectorAll('.moai-list .moai-line[data-id]')].find((line) => line.dataset.id === 'se-e1.b')
  row.click()
  assert.deepEqual(panel.calls.at(-1), ['choose', 'se-e1.b'])
  assert.equal(panel.$('.moai-detail .m-empty-title').textContent, en.detail.none, 'nothing loaded yet: the pane says to choose')
  panel.store.dispatch({ type: 'detail-loaded', data: { id: 'se-e1.b', row: ROWS[3] } })
  assert.equal(panel.$('.moai-detail h2').textContent, 'Board')
  assert.equal(panel.$('.moai-detail .m-empty-title'), null)

  panel.shell.input.value = 'New one'
  panel.$('.moai-add-button').click()
  assert.deepEqual(panel.calls.at(-1), ['add', 'New one'])
  panel.shell.say('Enter a task title.', true)
  assert.equal(panel.$('.moai-result').className, 'moai-result m-banner m-banner-danger')
  panel.shell.refuse({ kind: 'refused', code: 'declined' })
  assert.equal(panel.$('.moai-result').className, 'moai-result m-banner')
})
