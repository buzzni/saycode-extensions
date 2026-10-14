// Moai panel key wiring (se-jwl3): the key router as main.ts wires it (keys/wiring.ts) — one keydown listener on
// the document, its action ids turned into store actions and pane commands, the SPC menu, the help overlay and the
// sort editor — in a jsdom document with the shell mounted.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

import { panelModule } from './moai-panel-modules.mjs'

const { createStore } = await panelModule('store.ts')
const { IssueIndex } = await panelModule('data/index.ts')
const { copyFor } = await panelModule('i18n/index.ts')
const { mountShell } = await panelModule('view/shell.ts')
const { PANES } = await panelModule('view/panes.ts')
const { wireKeys, keyContext, NOT_WIRED } = await panelModule('keys/wiring.ts')
const { KEY_TABLE } = await panelModule('keys/table.ts')

const en = copyFor('en')

// A milestone with an epic in it (folders to go into), and two loose rows.
const ROWS = [
  { id: 'm1', kind: 'milestone', title: 'v1', status: 'todo' },
  { id: 'e1', kind: 'epic', title: 'Epic one', milestone: 'm1', status: 'todo' },
  { id: 'e1.a', kind: 'issue', title: 'Alpha', epic: 'e1', derived_epic: 'e1', milestone: 'm1', status: 'todo', priority: 1 },
  { id: 'e1.b', kind: 'issue', title: 'Beta', epic: 'e1', derived_epic: 'e1', milestone: 'm1', status: 'in_progress', priority: 2 },
  { id: 'e1.c', kind: 'issue', title: 'Gamma', epic: 'e1', derived_epic: 'e1', milestone: 'm1', status: 'todo', priority: 3 },
]

const PAGES = [
  { slug: 'README', title: 'Readme', path: 'README.md' },
  { slug: 'guide', title: 'Guide', path: 'docs/guide.md' },
  { slug: 'notes', title: 'Notes', path: 'docs/notes.md' },
]
const wikiSource = () => ({
  list: async () => ({ dir: 'docs', pages: PAGES }),
  page: async (slug) => {
    const page = PAGES.find((one) => one.slug === slug)
    return { ...page, body: `# ${page.title}\n\nSee [the guide](guide.md) and [the readme](README.md).\n` }
  },
})

function boot({ wiki } = {}) {
  const dom = new JSDOM('<!doctype html><html lang="en"><body><div id="moai-app"></div></body></html>', { pretendToBeVisual: true })
  const doc = dom.window.document
  const store = createStore()
  const index = new IssueIndex(ROWS)
  const chosen = []
  const shell = mountShell(doc.getElementById('moai-app'), {
    document: doc,
    store,
    copy: en,
    language: 'en',
    panes: PANES,
    index: (state) => (state.board.value ? index : null),
    activity: () => ({ phase: 'idle', cancellable: false }),
    intents: {
      refresh() {},
      choose: (id) => {
        chosen.push(id)
        store.dispatch({ type: 'cursor', id })
      },
      add() {},
      cancel() {},
    },
    wiki,
  })
  store.dispatch({ type: 'board-loaded', data: { rows: ROWS, more: 0, loadedAt: Date.now() } })
  const keys = wireKeys({ document: doc, store, shell, copy: en, platform: 'other' })
  const $ = (selector) => doc.querySelector(selector)
  /** A keydown on `target` (the focused element when left out), as the browser sends it. */
  const press = (key, init = {}, target = doc.activeElement ?? doc.body) => {
    const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
    target.dispatchEvent(event)
    return event
  }
  const seq = (...keys) => keys.forEach((key) => press(key))
  const lines = () => [...doc.querySelectorAll('.m-pane-main[data-pane="list"] .moai-line')].map((line) => line.dataset.key)
  return { dom, doc, store, shell, keys, $, press, seq, lines, chosen, state: () => store.getState() }
}

const ticks = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** In the epic, the cursor on its first row and the list focused. */
function inEpic() {
  const panel = boot()
  panel.store.dispatch({ type: 'enter', path: ['m:m1', 'e:e1'], cursor: 'e1.a' })
  panel.shell.focusPane('list')
  return panel
}

test('keys: j and k move the cursor exactly one row in the drawn order, ↓ too — no key runs twice', () => {
  const panel = inEpic()
  assert.deepEqual(panel.lines(), ['..', 'e1.a', 'e1.b', 'e1.c'])
  assert.equal(panel.doc.activeElement, panel.$('.moai-list'))
  const j = panel.press('j')
  assert.equal(j.defaultPrevented, true)
  assert.equal(panel.state().cursor, 'e1.b', 'one j, one row')
  panel.press('ArrowDown')
  assert.equal(panel.state().cursor, 'e1.c', 'one ↓, one row: the list has no keydown listener of its own')
  panel.press('k')
  assert.equal(panel.state().cursor, 'e1.b')
  // gg, then G: the sequence buffer.
  panel.seq('g', 'g')
  assert.equal(panel.state().cursor, '..')
  panel.press('G')
  assert.equal(panel.state().cursor, 'e1.c')
})

test('keys: a Korean input source — the jamo of J with code KeyJ moves the cursor', () => {
  const panel = inEpic()
  panel.press('ㅓ', { code: 'KeyJ' })
  assert.equal(panel.state().cursor, 'e1.b')
  panel.press('Process', { code: 'KeyK', keyCode: 229 })
  assert.equal(panel.state().cursor, 'e1.a')
})

test('keys: Enter goes into a folder and Backspace leaves it, landing on the folder', () => {
  const panel = boot()
  panel.store.dispatch({ type: 'enter', path: ['m:m1'], cursor: 'e1' })
  panel.shell.focusPane('list')
  panel.press('Enter')
  assert.deepEqual(panel.state().path, ['m:m1', 'e:e1'])
  assert.equal(panel.state().cursor, 'e1.a')
  const back = panel.press('Backspace')
  assert.equal(back.defaultPrevented, true)
  assert.deepEqual(panel.state().path, ['m:m1'])
  assert.equal(panel.state().cursor, 'e1')
  // Enter on a leaf shows it and the focus goes to the detail.
  panel.press('Enter')
  panel.press('j')
  panel.press('Enter')
  assert.deepEqual(panel.chosen, ['e1.b'])
  assert.equal(panel.state().focus, 'detail')
  // Backspace is the list's: from the detail it does nothing.
  panel.press('Backspace')
  assert.deepEqual(panel.state().path, ['m:m1', 'e:e1'])
  // Tab unfolds everything under a folder, and folds it again.
  panel.shell.focusPane('list')
  panel.press('Backspace')
  assert.equal(panel.state().cursor, 'e1')
  panel.press('Tab')
  assert.ok(panel.state().expanded.length > 0)
  assert.ok(panel.lines().includes('e1.a'))
  panel.press('Tab')
  assert.deepEqual(panel.state().expanded, [])
})

test('keys: SPC opens the menu; a toggle from it runs, keeps the menu open and redraws its state', () => {
  const panel = inEpic()
  const menu = panel.keys.menu.el
  assert.ok(menu.isConnected && menu.hidden)
  panel.press(' ')
  assert.equal(menu.hidden, false)
  assert.deepEqual(panel.keys.router.state().menu, ['SPC'])
  panel.press('v')
  const deferred = () => menu.querySelector('[data-key="l"] .m-wk-state').textContent
  assert.equal(deferred(), '[숨김]')
  panel.press('l')
  assert.equal(panel.state().view.hideDeferred, false)
  assert.equal(menu.hidden, false, 'a toggle keeps the menu open')
  assert.equal(deferred(), '[보임]', 'the menu is drawn again after a toggle that does not change its layer')
  // A click on an item is the key press.
  menu.querySelector('[data-key="l"]').click()
  assert.equal(panel.state().view.hideDeferred, true)
  assert.equal(deferred(), '[숨김]')
  // A store change from elsewhere redraws it too.
  panel.store.dispatch({ type: 'view', view: { hideDeferred: false } })
  assert.equal(deferred(), '[보임]')
  panel.press('Escape')
  assert.equal(menu.hidden, true)
  // SPC c i turns the id cell off, SPC o d moves the detail, SPC v d hides it (toggles: Esc closes the menu).
  panel.seq(' ', 'c', 'i', 'Escape')
  assert.equal(panel.state().columns.id, false)
  panel.seq(' ', 'o', 'd', 'Escape')
  assert.equal(panel.state().detail.position, 'left')
  panel.seq(' ', 'v', 'd', 'Escape')
  assert.equal(panel.state().detail.visible, false)
  assert.equal(menu.hidden, true)
  // An action item closes it: SPC g b.
  panel.seq(' ', 'g', 'b')
  assert.equal(panel.state().tab, 'board')
  assert.equal(menu.hidden, true)
})

test('keys: ? opens the help; keys are quiet while it is open, even with the focus outside it; Esc closes', () => {
  const panel = inEpic()
  panel.press('?')
  assert.equal(panel.keys.help.isOpen(), true)
  assert.equal(panel.doc.activeElement, panel.keys.help.el)
  // The focus leaves the overlay (a click behind it): the panel's keys still do nothing.
  panel.doc.body.focus()
  panel.press('j', {}, panel.doc.body)
  panel.press(' ', {}, panel.doc.body)
  assert.equal(panel.state().cursor, 'e1.a')
  assert.equal(panel.keys.router.state().menu, null)
  const esc = panel.press('Escape', {}, panel.doc.body)
  assert.equal(esc.defaultPrevented, true)
  assert.equal(panel.keys.help.isOpen(), false)
  panel.press('j', {}, panel.doc.body)
  assert.equal(panel.state().cursor, 'e1.b', 'the router works again')
  // SPC ? opens it too.
  panel.seq(' ', '?')
  assert.equal(panel.keys.help.isOpen(), true)
})

test('keys: Enter on a focused button is the button\'s — the router does not run `enter` or block the click', () => {
  const panel = boot()
  panel.store.dispatch({ type: 'enter', path: ['m:m1'], cursor: 'e1' })
  const sort = panel.$('.m-toolbar-slot .m-sort button')
  sort.focus()
  const enter = panel.press('Enter')
  assert.equal(enter.defaultPrevented, false, 'the click Enter makes is not prevented')
  assert.deepEqual(panel.state().path, ['m:m1'], '`enter` did not run')
  const space = panel.press(' ')
  assert.equal(space.defaultPrevented, false)
  assert.equal(panel.keys.router.state().menu, null, 'Space clicks the button, it does not open the menu')
  // Other keys on a button still reach the router.
  panel.press('k')
  assert.equal(panel.state().cursor, '..')
})

test('keys: / opens the search and puts the caret in it; typing there is text, Esc goes back to the list', () => {
  const panel = inEpic()
  const slash = panel.press('/')
  assert.equal(slash.defaultPrevented, true, 'the / is not typed into the search')
  const search = panel.shell.toolbar.searchInput
  assert.equal(panel.doc.activeElement, search)
  assert.equal(panel.state().search.open, true)
  assert.equal(panel.keys.context().mode, 'prompt')
  for (const key of ['j', 'k', 'G', ' ', 'q']) assert.equal(panel.press(key).defaultPrevented, false, `${key} types`)
  assert.equal(panel.state().cursor, 'e1.a')
  assert.equal(panel.keys.router.state().menu, null)
  // Tab cycles the scope (prompt mode), Esc closes the search and puts the focus back on the list.
  panel.press('Tab')
  assert.equal(panel.state().search.scope, 'id')
  panel.press('Escape')
  assert.equal(panel.state().search.open, false)
  assert.equal(panel.doc.activeElement, panel.$('.moai-list'))
  panel.press('j')
  assert.equal(panel.state().cursor, 'e1.b')
  // SPC f puts the caret in the filter.
  panel.seq(' ', 'f')
  assert.equal(panel.doc.activeElement, panel.shell.toolbar.filterInput)
})

test('keys: SPC s sorts by a field; SPC s e opens the sort editor (sorter mode), Esc puts the order back', () => {
  const panel = inEpic()
  panel.seq(' ', 's', 't')
  assert.deepEqual(panel.state().sort.fields, [{ key: 'title', dir: 'asc' }])
  assert.equal(panel.$('.m-whichkey [data-key="t"] .m-wk-state').textContent, '[↑ 오름]')
  panel.press('t')
  assert.deepEqual(panel.state().sort.fields, [{ key: 'title', dir: 'desc' }], 'again turns it around')
  panel.press('P')
  assert.deepEqual(panel.state().sort.fields.map((f) => f.key), ['title', 'priority'])
  panel.press('Escape')
  const before = panel.state().sort
  panel.seq(' ', 's', 'e')
  assert.equal(panel.state().toolbar.sortOpen, true)
  assert.equal(panel.keys.context().mode, 'sorter')
  const cursorRow = () => panel.$('.m-sort-pop [data-cursor]')?.dataset.key
  assert.equal(cursorRow(), 'title', 'the editor opens on the first field')
  panel.press('j')
  assert.equal(cursorRow(), 'id')
  panel.seq('k', 'k', 'k')
  assert.equal(cursorRow(), 'status')
  panel.press(' ')
  assert.deepEqual(panel.state().sort.fields.map((f) => f.key), ['title', 'priority', 'status'], 'SPC puts it in')
  panel.press('K')
  assert.deepEqual(panel.state().sort.fields.map((f) => f.key), ['title', 'status', 'priority'], 'K moves it up')
  panel.press('d')
  assert.equal(panel.state().sort.fields[1].dir, 'desc')
  assert.equal(panel.state().cursor, 'e1.a', 'j/k moved the editor, not the list')
  panel.press('Escape')
  assert.equal(panel.state().toolbar.sortOpen, false)
  assert.deepEqual(panel.state().sort, before, 'Esc cancels')
  panel.seq(' ', 's', 'e')
  panel.press('k')
  panel.press(' ')
  panel.press('Enter')
  assert.equal(panel.state().toolbar.sortOpen, false)
  assert.notDeepEqual(panel.state().sort, before, 'Enter keeps it')
  assert.equal(panel.keys.context().mode, 'browse')
})

test('keys: wiki mode — keys reach the wiki pane, SPC v r toggles raw, Tab cycles links and Esc gets out to the tab bar', async () => {
  const panel = boot({ wiki: wikiSource() })
  panel.shell.focusPane('list')
  panel.seq(' ', 'g', 'w')
  assert.equal(panel.state().tab, 'wiki')
  await ticks()
  assert.equal(panel.keys.context().mode, 'wiki')
  const selected = () => panel.$('#m-panel-wiki .m-wiki-list [aria-selected="true"]')?.dataset.slug
  assert.equal(selected(), 'README')
  panel.press('j')
  assert.equal(selected(), 'guide', 'j moves the wiki list cursor, once')
  // A motion key closes the SPC menu and moves — once: the wiki pane has no keydown listener of its own.
  panel.seq(' ', 'j')
  assert.equal(panel.keys.router.state().menu, null)
  assert.equal(selected(), 'notes')
  panel.press('ㅏ', { code: 'KeyK' })
  assert.equal(selected(), 'guide', 'a jamo reaches the wiki through its command')
  // The help keeps the wiki quiet too, with the focus on the wiki's list behind it.
  panel.press('?')
  panel.$('#m-panel-wiki .m-wiki-list [aria-selected="true"]').focus()
  panel.press('j')
  assert.equal(selected(), 'guide')
  panel.press('Escape')
  assert.equal(panel.keys.help.isOpen(), false)
  panel.shell.focusPane('list')
  panel.press('Enter')
  await ticks()
  assert.equal(panel.$('#m-panel-wiki .m-wiki-title').textContent, 'Guide')
  // SPC v r: the wiki's raw toggle (the menu's state label follows it).
  const raw = panel.$('#m-panel-wiki .m-wiki-actions button[aria-pressed]')
  assert.equal(raw.getAttribute('aria-pressed'), 'false')
  panel.seq(' ', 'v')
  assert.equal(panel.keys.menu.el.querySelector('[data-key="r"] .m-wk-state').textContent, '[렌더링]')
  panel.press('r')
  assert.equal(raw.getAttribute('aria-pressed'), 'true')
  assert.equal(panel.keys.menu.el.querySelector('[data-key="r"] .m-wk-state').textContent, '[원문]')
  panel.press('Escape')
  panel.seq(' ', 'v', 'r')
  assert.equal(raw.getAttribute('aria-pressed'), 'false')
  panel.press('Escape')
  // Into the page, Tab selects a link; Esc clears the selection, the next Esc goes to the tab bar.
  panel.press('l')
  assert.equal(panel.keys.context().focus, 'page')
  const tab = panel.press('Tab')
  assert.equal(tab.defaultPrevented, true)
  assert.ok(panel.$('#m-panel-wiki .m-md-link[aria-current="true"]'), 'a link is selected')
  panel.press('Escape')
  assert.equal(panel.$('#m-panel-wiki .m-md-link[aria-current="true"]'), null)
  assert.notEqual(panel.doc.activeElement, panel.$('[role="tab"][data-tab="wiki"]'))
  panel.press('Escape')
  assert.equal(panel.doc.activeElement, panel.$('[role="tab"][data-tab="wiki"]'), 'the way out of the wiki')
  // / is the wiki's search there, a prompt: typing is text, Esc goes back.
  panel.shell.focusPane('list')
  panel.press('/')
  const search = panel.$('#m-panel-wiki .m-wiki-search input')
  assert.equal(panel.doc.activeElement, search)
  assert.equal(panel.keys.context().mode, 'prompt')
  assert.equal(panel.press('j').defaultPrevented, false)
  panel.press('Escape')
  assert.notEqual(panel.doc.activeElement, search)
  panel.seq(' ', 'g', 'l')
  assert.equal(panel.state().tab, 'list')
})

test('keys: the board — j/k inside a column, l to the next column with cards, Enter shows the card', () => {
  const panel = boot()
  panel.store.dispatch({ type: 'enter', path: ['m:m1', 'e:e1'], cursor: 'e1.a' })
  panel.seq(' ', 'g', 'b')
  assert.equal(panel.state().tab, 'board')
  panel.press('j')
  assert.equal(panel.state().cursor, 'e1.c', 'the next card in the todo column')
  panel.press('l')
  assert.equal(panel.state().cursor, 'e1.b', 'the in-progress column')
  panel.press('Enter')
  assert.deepEqual(panel.chosen, ['e1.b'])
})

test('keys: every action of the key table has a dispatch target; read marks are not wired and not offered', () => {
  const panel = inEpic()
  const ids = new Set(Object.values(KEY_TABLE).flat().map((binding) => binding.action))
  const missing = [...ids].filter((id) => !panel.keys.actions.includes(id))
  assert.deepEqual(missing, [])
  for (const id of Object.keys(NOT_WIRED)) assert.ok(ids.has(id), `${id} is a table action`)
  // `r` and SPC m are unavailable: the menu has no SPC m layer and `r` runs nothing.
  assert.equal(panel.keys.context().readable, false)
  panel.press(' ')
  assert.equal(panel.keys.menu.el.querySelector('[data-key="m"]'), null)
  panel.press('Escape')
  assert.equal(panel.press('r').defaultPrevented, false)
  // The context speaks the store's vocabulary in the table's: archived polarity, `status`, `names`.
  const ctx = keyContext({ ...panel.state(), view: { ...panel.state().view, showArchived: true }, sort: { fields: [{ key: 'status', dir: 'desc' }, { key: 'id', dir: 'asc' }], reversed: false } }, { mode: 'browse', width: 900 })
  assert.equal(ctx.hidden.archived, false)
  assert.deepEqual(ctx.sort, [{ field: 'status', desc: true }])
  assert.equal(ctx.cells.names, true)
  assert.deepEqual(ctx.columns, ['todo', 'in_progress', 'review', 'done'])
  // The focus hint is in the page, in the panel's language.
  assert.equal(panel.keys.hint.textContent, en.keys.focusHint)
  assert.ok(panel.keys.hint.isConnected)
})
