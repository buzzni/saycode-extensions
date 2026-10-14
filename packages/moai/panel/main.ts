/**
 * Boots the board panel: waits for the host bridge, restores the remembered settings, wires the store to the
 * data layer and mounts the shell (view/shell.ts), which renders from the store.
 * Built by build.mjs into the single file dist/panel.html.
 */
import { createClient, PANEL_CLIENT_OPTIONS, PRIORITY, type Bridge, type Outcome } from './data/client.js'
import { CompatProbe } from './data/compat.js'
import { IssueIndex, type Row } from './data/index.js'
import { createMemory, remember } from './data/memory.js'
import { markAllRead, markGroupRead, markRead, type Marked } from './data/read.js'
import { createRefresher } from './data/refresh.js'
import { addTask, loadAllRows, loadArchived, loadDetail, loadTallies, loadWikiListing, loadWikiPage, sameTallies, withArchive, type Loaded } from './data/source.js'
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
// What the reads' answers tell of the moai CLI and the daemon's catalog (data/compat.ts): the list, archive and wiki
// reads and the read marks hand it their outcomes (the detail and the add do not), and the shell's banner says what
// to upgrade, update or install. Its report goes in the store after each answer it is handed, one that lands after
// its read was given up on too (the backlog read beside a failed `show --all`); the store keeps only a changed one.
const probe = new CompatProbe()
probe.subscribe(() => store.dispatch({ type: 'compat', report: probe.report() }))

// The index is built once per read, not per render: again when the rows, the status counts or the archive shown change.
let indexed: { rows: Row[]; tallies: BoardData['tallies']; archive: Row[] | null; index: IssueIndex } | null = null
function indexOf(state: State): IssueIndex | null {
  const board = state.board.value
  if (!board) return null
  const archive = state.view.showArchived ? state.archive : null
  if (indexed?.rows !== board.rows || indexed.tallies !== board.tallies || indexed.archive !== archive) {
    indexed = { rows: board.rows, tallies: board.tallies, archive, index: new IssueIndex(withArchive(board, archive), board.tallies) }
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
  // Without the counts the board counts its own rows. The load does not wait for the counts (their confirmation may
  // still be open): a failure is told at once, rows are drawn at once, and the counts are put on them when they come.
  // A refresh asked for meanwhile, or the `fresh` read after a write, reads its own rows and shares the status read
  // still running (client.ts); none of the panel's writes — an add with no group, read marks — moves a count.
  const listing = loadAllRows(client, PRIORITY.list, probe)
  const counting = loadTallies(client, PRIORITY.list, probe)
  let counted: Awaited<typeof counting> | undefined
  void counting.then((tallies) => { counted = tallies })
  const loaded = await listing
  if (!loaded.ok) {
    store.dispatch({ type: 'board-failed', problem: loaded.outcome })
    return
  }
  const { rows, more, truncated, partial } = loaded.value
  const before = store.getState()
  // Counts that came first go in with the rows, so the board is not drawn twice. Until this read's counts come, a
  // refresh keeps the counts the board showed: its rows alone undercount (they leave the archived members out).
  const carried = counted === undefined ? before.board.value?.tallies : undefined
  const counts = counted?.ok ? counted.value : carried
  const data: BoardData = { rows, more, truncated, partial, loadedAt: Date.now(), ...(counts ? { tallies: counts } : {}) }
  const shownBefore = before.shown.value
  // The detail on screen was read before this list and stands beside it: when its row has left the list
  // (finished, moved away) the pane goes with it, as choose() does for a read still running. A detail the list
  // never held (an issue a wiki page links to that only the archive holds) stays.
  const wasListed = shownBefore !== null && indexOf(before)?.find(shownBefore.id) !== undefined
  store.dispatch({ type: 'board-loaded', data, order: drawnOrder() })
  const state = store.getState()
  const shown = state.shown.value
  if (shown && wasListed && indexOf(state)?.find(shown.id) === undefined) store.dispatch({ type: 'detail-closed' })
  // Archived rows shown but not read yet (turned on before the rows were there, or the last read failed). Not while
  // a read still pages: that one would be cancelled and the paging started over.
  if (state.view.showArchived && state.archive === null && archiveRunning === null) void loadArchive()
  // Counts that come later go on this board only: a later load's board has its own (store 'tallies'). Counts that
  // match the ones carried (most refreshes) change nothing on screen, so the board is not drawn again for them;
  // counts that could not be read leave the board counting its own rows, as when they fail first.
  if (counted === undefined) {
    void counting.then((late) => {
      if (late.ok ? !sameTallies(late.value, carried) : carried) store.dispatch({ type: 'tallies', data, tallies: late.ok ? late.value : null })
    })
  }
}

// The archive is read when archived rows are shown (`SPC v o`), each time they are turned on, once the active
// rows are there: a row they do not hold is archive-only, tagged `archived: true` (never NEW, never read-marked;
// a partial list — prime's rows — judges by column instead, source.ts activeIds).
let archiving = 0
/** The `archiving` number of the archive read still paging, or null when none is. */
let archiveRunning: number | null = null
async function loadArchive(): Promise<void> {
  if (!store.getState().board.value) return
  const mine = ++archiving
  archiveRunning = mine
  try {
    // Read without `active`, as moai printed it (moai 0.17 marks its archive rows itself): withArchive tags the
    // archive-only rows left unmarked against the rows held when it draws, and a partial list needs the archive's own
    // rows to judge by (source.ts activeIds).
    const loaded = await loadArchived(client, { probe, cancelled: () => mine !== archiving })
    if (mine !== archiving) return
    // The archive's own problem: the board's rows and whatever the board said stand.
    if (loaded.ok) store.dispatch({ type: 'archive', rows: loaded.value })
    else store.dispatch({ type: 'archive-failed', problem: loaded.outcome })
  } finally {
    if (archiveRunning === mine) archiveRunning = null
  }
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

// Paused while the panel is out of sight — the Desktop window hidden, or the tool tab it sits in: the refresher's
// own visibility signal hears both (data/refresh.ts panelVisibility).
const refresher = createRefresher({ load: loadBoard })

let choice = 0
async function choose(id: string) {
  const mine = ++choice
  // Only a row the list held can be "removed by a reload" below; an issue the list never held (a wiki page's link
  // to one only the archive holds) is shown when its read answers.
  const held = indexOf(store.getState())?.find(id) !== undefined
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
  if (held && listed && listed.find(id) === undefined) return store.dispatch({ type: 'detail-closed' })
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
  list: async () => answer(await loadWikiListing(client, probe)),
  page: async (slug) => answer(await loadWikiPage(client, slug, probe)),
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
  one: (id) => marked(markRead(client, { id }, probe)),
  all: () => marked(markAllRead(client, probe)),
  group: (id) => marked(markGroupRead(client, id, probe)),
}

function activity(): Activity {
  const requests = client.requests().filter((request) => request.phase !== 'queued')
  const running = requests.find((request) => request.operationId !== null)
  return {
    phase: running ? 'running' : requests.length ? 'starting' : 'idle',
    waiting: requests.some((request) => request.phase === 'starting'),
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
    // Up to three runs go at once (the list is three reads): Cancel stops every one that runs, and the reads that
    // wait behind them, rather than letting the next queued read start in the freed slot. A write still waiting
    // (its confirmation open, or queued) is left to the person: cancelling it would cancel it the moment they
    // approve it.
    cancel: () => {
      const requests = client.requests()
      if (!requests.some((request) => request.operationId !== null)) return
      for (const key of new Set(requests.filter((request) => request.operationId !== null || request.share).map((request) => request.key))) client.cancel(key)
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
