/**
 * Boots the board panel: waits for the host bridge, wires the store to the data layer and renders.
 * Built by build.mjs into the single file dist/panel.html.
 */
import { createClient, type Bridge } from './data/client.js'
import { IssueIndex, type Row } from './data/index.js'
import { createRefresher, refreshTime } from './data/refresh.js'
import { addTask, loadDetail, loadRows } from './data/source.js'
import { copyFor } from './i18n/index.js'
import { createStore, type State } from './store.js'
import { mountInterim, type Activity } from './view/interim.js'

declare global {
  interface Window {
    saycodePanel?: Bridge & { ready?: Promise<unknown> }
  }
}

const bridge = window.saycodePanel
const language = document.documentElement.lang || navigator.language || 'en'
const copy = copyFor(language)
const store = createStore()
const client = createClient(bridge ?? { invokeCommand: () => Promise.reject(new Error('no panel bridge')) })

// The index is built once per read, not per render.
let indexed: { rows: Row[]; index: IssueIndex } | null = null
function indexOf(state: State): IssueIndex | null {
  const rows = state.board.value?.rows
  if (!rows) return null
  if (indexed?.rows !== rows) indexed = { rows, index: new IssueIndex(rows) }
  return indexed.index
}

/** The ids in the order the list draws them now, so a reload can keep the cursor near where it was. */
function drawnOrder(): string[] {
  const state = store.getState()
  const index = indexOf(state)
  if (!index) return []
  return index.entries(state.path).flatMap((entry) => (entry.at === undefined ? [] : [index.rows[entry.at]!.id]))
}

async function loadBoard(): Promise<void> {
  store.dispatch({ type: 'board-loading' })
  const loaded = await loadRows(client)
  if (loaded.ok) store.dispatch({ type: 'board-loaded', data: { rows: loaded.value.rows, more: loaded.value.more, loadedAt: Date.now() }, order: drawnOrder() })
  else store.dispatch({ type: 'board-failed', problem: loaded.outcome })
}

const refresher = createRefresher({ load: loadBoard, isVisible: () => document.visibilityState !== 'hidden' })
document.addEventListener('visibilitychange', () => refresher.visibilityChanged())

async function choose(id: string) {
  store.dispatch({ type: 'cursor', id })
  store.dispatch({ type: 'detail-loading', id })
  const loaded = await loadDetail(client, id)
  // A later choice wins; an answer for a row no longer under the cursor is dropped.
  if (store.getState().cursor !== id) return
  if (loaded.ok) store.dispatch({ type: 'detail-loaded', data: { id, row: loaded.value } })
  else store.dispatch({ type: 'detail-failed', id, problem: loaded.outcome })
}

let adding = false
async function add(text: string) {
  const title = text.trim()
  if (!title) return view.say(copy.titleRequired, true)
  if (adding) return
  adding = true
  view.say('')
  try {
    const added = await addTask(client, title)
    if (!added.ok) {
      view.explain(added.outcome)
      return
    }
    view.say(copy.added({ id: added.value.id, title: typeof added.value.title === 'string' ? added.value.title : title }))
    const input = root.querySelector('input')
    if (input) input.value = ''
    await refresher.refresh()
  } finally {
    adding = false
  }
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
const view = mountInterim(root, copy, language, {
  refresh: () => void refresher.refresh(),
  enter: (path) => store.dispatch({ type: 'enter', path }),
  choose: (id) => void choose(id),
  closeDetail: () => store.dispatch({ type: 'detail-closed' }),
  add: (title) => void add(title),
  cancel: () => {
    const running = client.requests().find((request) => request.operationId !== null)
    if (running) client.cancel(running.key)
  },
})

const render = () => {
  const state = store.getState()
  const loadedAt = state.board.value?.loadedAt
  view.render(state, indexOf(state), activity(), loadedAt === undefined ? null : refreshTime(loadedAt, language))
}
store.subscribe(render)
client.subscribe(render)
render()

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
