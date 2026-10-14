/**
 * Boots the board panel: waits for the host bridge, restores the remembered settings, wires the store to the
 * data layer and mounts the shell (view/shell.ts), which renders from the store.
 * Built by build.mjs into the single file dist/panel.html.
 */
import { createClient, PANEL_CLIENT_OPTIONS, type Bridge, type Outcome } from './data/client.js'
import { IssueIndex, type Row } from './data/index.js'
import { createMemory, remember } from './data/memory.js'
import { markAllRead, markGroupRead, markRead, type Marked } from './data/read.js'
import { createRefresher } from './data/refresh.js'
import { addTask, loadAllRows, loadArchived, loadDetail, loadTallies, loadWikiListing, loadWikiPage, type Loaded } from './data/source.js'
import { copyFor } from './i18n/index.js'
import { wireKeys, type ReadMarks } from './keys/wiring.js'
import { createStore, type BoardData, type State } from './store.js'
import { listLines, narrow, sortOrder } from './view/list-model.js'
import { PANES } from './view/panes.js'
import { describe, mountShell, type Activity } from './view/shell.js'
import type { WikiSource } from './view/types.js'

declare global {
  interface Window {
    saycodePanel?: Bridge & { ready?: Promise<unknown> }
  }
}

const bridge = window.saycodePanel
const language = document.documentElement.lang || navigator.language || 'en'
const copy = copyFor(language)
const store = createStore()
// The last tab and the detail's place come back before anything is drawn. localStorage when the frame may use
// it, else this session only (data/memory.ts); reading `window.localStorage` itself can throw, hence the getter.
remember(store, createMemory(() => window.localStorage))
// Up to 3 reads at once, and a read refused as workspace-busy tried again (data/client.ts PANEL_CLIENT_OPTIONS).
const client = createClient(bridge ?? { invokeCommand: () => Promise.reject(new Error('no panel bridge')) }, PANEL_CLIENT_OPTIONS)

/** The active rows, then the archive's rows no active row holds (only while archived rows are shown). */
function withArchive(rows: Row[], archive: Row[] | null): Row[] {
  if (!archive) return rows
  const active = new Set(rows.map((row) => row.id))
  const away = archive.filter((row) => row.archived === true && !active.has(row.id))
  return away.length ? [...rows, ...away] : rows
}

// The index is built once per read, not per render: again when the rows, the status counts or the archive shown change.
let indexed: { rows: Row[]; tallies: BoardData['tallies']; archive: Row[] | null; index: IssueIndex } | null = null
function indexOf(state: State): IssueIndex | null {
  const board = state.board.value
  if (!board) return null
  const archive = state.view.showArchived ? state.archive : null
  if (indexed?.rows !== board.rows || indexed.tallies !== board.tallies || indexed.archive !== archive) {
    indexed = { rows: board.rows, tallies: board.tallies, archive, index: new IssueIndex(withArchive(board.rows, archive), board.tallies) }
  }
  return indexed.index
}

/** The ids in the order the list draws them now (its hiding, filter, search, order and unfolded folders), so a reload can keep the cursor near where it was. */
function drawnOrder(): string[] {
  const state = store.getState()
  const index = indexOf(state)
  if (!index) return []
  const lines = listLines(state, index, narrow(state, index).keep, sortOrder(state.sort, index))
  return lines.flatMap((line) => (line.kind === 'row' ? [line.key] : []))
}

async function loadBoard(): Promise<void> {
  store.dispatch({ type: 'board-loading' })
  // The rows and the milestone and epic counts `moai status` prints (they count archived rows too) side by side.
  // Without the counts the board counts its own rows.
  const [loaded, tallies] = await Promise.all([loadAllRows(client), loadTallies(client)])
  if (loaded.ok) {
    const { rows, more, truncated } = loaded.value
    const data: BoardData = { rows, more, truncated, loadedAt: Date.now(), ...(tallies.ok ? { tallies: tallies.value } : {}) }
    store.dispatch({ type: 'board-loaded', data, order: drawnOrder() })
    // The detail on screen was read before this list and stands beside it: when its row has left the list
    // (finished, moved away) the pane goes with it, as choose() does for a read still running.
    const state = store.getState()
    const shown = state.shown.value
    if (shown && indexOf(state)?.find(shown.id) === undefined) store.dispatch({ type: 'detail-closed' })
  } else store.dispatch({ type: 'board-failed', problem: loaded.outcome })
  if (loaded.ok && store.getState().view.showArchived && store.getState().archive === null) void loadArchive()
}

// The archive is read when archived rows are shown (`SPC v o`), each time they are turned on, once the active
// rows are there: a row they do not hold is archive-only, tagged `archived: true` (never NEW, never read-marked).
let archiving = 0
async function loadArchive(): Promise<void> {
  const rows = store.getState().board.value?.rows
  if (!rows) return
  const mine = ++archiving
  const loaded = await loadArchived(client, { active: new Set(rows.map((row) => row.id)), cancelled: () => mine !== archiving })
  if (mine !== archiving) return
  if (loaded.ok) store.dispatch({ type: 'archive', rows: loaded.value })
  else store.dispatch({ type: 'board-failed', problem: loaded.outcome })
}
store.subscribe((state, previous) => {
  if (state.view.showArchived === previous.view.showArchived) return
  if (state.view.showArchived) void loadArchive()
  else {
    // Turned off: a read still paging is not wanted, and the next turn-on reads the archive afresh.
    archiving++
    store.dispatch({ type: 'archive', rows: null })
  }
})

const refresher = createRefresher({ load: loadBoard, isVisible: () => document.visibilityState !== 'hidden' })
document.addEventListener('visibilitychange', () => refresher.visibilityChanged())

let choice = 0
async function choose(id: string) {
  const mine = ++choice
  store.dispatch({ type: 'cursor', id })
  store.dispatch({ type: 'detail-loading', id })
  const loaded = await loadDetail(client, id)
  // A later choice wins: its own answer settles the detail.
  if (mine !== choice) return
  const now = store.getState()
  // The pane was closed while the read ran (Close, or a reload that closed it): the answer is not wanted.
  if (!now.shown.loading) return
  // A reload removed the row. Nothing else will answer for the detail, so it closes instead of staying on
  // "Loading…". The cursor moving elsewhere is the user's own (a key press) and does not cancel the read.
  const listed = indexOf(now)
  if (listed && listed.find(id) === undefined) return store.dispatch({ type: 'detail-closed' })
  if (loaded.ok) store.dispatch({ type: 'detail-loaded', data: { id, row: loaded.value } })
  else store.dispatch({ type: 'detail-failed', id, problem: loaded.outcome })
}

let adding = false
async function add(text: string) {
  const title = text.trim()
  if (!title) return shell.say(copy.titleRequired, true)
  if (adding) return
  adding = true
  shell.say('')
  try {
    const added = await addTask(client, title)
    if (!added.ok) return shell.refuse(added.outcome)
    shell.say(copy.added({ id: added.value.id, title: typeof added.value.title === 'string' ? added.value.title : title }))
    // The field stays editable while an add runs: clear it only if it still holds what was sent.
    if (shell.input.value === text) shell.input.value = ''
    // A list read already running started before the add and cannot hold the new task.
    await refresher.refresh({ fresh: true })
  } finally {
    adding = false
  }
}

/** What an outcome says, as one line of text (the wiki's error state takes a string). */
function said(outcome: Outcome): string {
  const parts = describe(outcome, copy, document)?.parts ?? [copy.failed]
  return parts.map((part) => (typeof part === 'string' ? part : part.textContent ?? '')).join('')
}

/** A wiki read's answer, or an Error with what stopped it (the wiki view shows it). */
function answer(loaded: Loaded<unknown>): unknown {
  if (loaded.ok) return loaded.value
  throw new Error(said(loaded.outcome))
}

const wiki: WikiSource = {
  list: async () => answer(await loadWikiListing(client)),
  page: async (slug) => answer(await loadWikiPage(client, slug)),
}

/** A read-mark write, then the list again: the marks come back with the rows (data/read.ts). */
async function marked(writing: Promise<Marked>): Promise<Outcome | null> {
  const done = await writing
  if (!done.ok) return done.outcome
  // A list read already running started before the write and cannot hold its marks.
  await refresher.refresh({ fresh: true })
  return null
}

const read: ReadMarks = {
  one: (id) => marked(markRead(client, { id })),
  all: () => marked(markAllRead(client)),
  group: (id) => marked(markGroupRead(client, id)),
}

function activity(): Activity {
  const requests = client.requests().filter((request) => request.phase !== 'queued')
  const running = requests.find((request) => request.operationId !== null)
  return {
    phase: running ? 'running' : requests.length ? 'starting' : 'idle',
    // Nothing to cancel while the confirmation is still open: the run has no operation id yet.
    cancellable: running !== undefined,
  }
}

const root = document.getElementById('moai-app') ?? document.body
// The shell draws on every store change; the request queue changes only the activity line and Cancel.
const shell = mountShell(root, {
  document,
  store,
  copy,
  language,
  panes: PANES,
  index: indexOf,
  activity,
  wiki,
  intents: {
    refresh: () => void refresher.refresh(),
    choose: (id) => void choose(id),
    add: (title) => void add(title),
    // Up to three runs go at once (the list is three reads): Cancel stops every one that runs, and what waits
    // behind them, rather than letting the next queued read start in the freed slot.
    cancel: () => {
      const requests = client.requests()
      if (!requests.some((request) => request.operationId !== null)) return
      for (const key of new Set(requests.map((request) => request.key))) client.cancel(key)
    },
  },
})
client.subscribe(() => shell.activity(activity()))
// The one keydown listener: keys → the key table's actions → the store and the panes (keys/wiring.ts), with the
// SPC menu, the shortcut help and the "click to use the keyboard" hint.
wireKeys({ document, store, shell, copy, read })

void (async () => {
  try {
    await bridge?.ready
  } catch {
    // An older host without `ready` still answers commands.
  }
  // The host does not focus the panel's frame when it opens; try, so keys reach it once that is wired.
  document.body.tabIndex = -1
  document.body.focus({ preventScroll: true })
  await refresher.refresh()
})()
