/**
 * Where the panel's data comes from: one function per Moai read, each handing out plain values or the
 * {@link Outcome} that stopped it. Nothing above this module knows which profile answered.
 *
 * - The index rows come from `show --all` (active rows, done and deferred included, archive left out) and
 *   `backlog show --all` (the backlog the same way), read side by side ({@link loadAllRows}). The archive is
 *   Moai's clock too (a row done for `archive_days`), so a group's old done members are not among these rows
 *   until the archive is read. If the daemon cut `show --all` at the 1 MiB output limit the rows fall back to
 *   `prime` (what is held and what is ready) with `truncated: true`, so the view can say the list is partial.
 * - {@link loadRows}, which the panel boots with today, still reads `prime` alone: the board's jsdom tests
 *   (tests/moai.test.mjs) and main.ts answer only `prime`, and both are held by other work. Switching is
 *   main.ts calling {@link loadAllRows} (same arguments) once those tests answer `show-all` and `backlog-all`,
 *   with the board state taking `truncated` along: BoardData holds only `rows` and `more`, and in the fallback
 *   `more` counts only what prime held back, not what `show --all` would have listed.
 * - A partial answer (Moai's non-zero exit with its whole JSON still printed; see client.ts) is read like a
 *   whole one: the rows it could read, the wiki pages it did not skip. `prime` ends such a run with 0 itself.
 * - The column names come from `status` ({@link loadStatuses}).
 * - The archive is read page by page, 200 rows sorted by id, only when asked for ({@link loadArchived}).
 * - The wiki listing and pages are handed out as Moai printed them ({@link loadWikiListing},
 *   {@link loadWikiPage}); the wiki view parses them.
 *
 * These profiles are the ones the manifest declares. `status`, `prime`, `show`, `add`, `wiki-ls` and
 * `wiki-show` match the Happy daemon's shipped catalog; the others are assumed to be added to it
 * (se-0g4a.anz) until it is checked live. The catalog's own `buzzni.moai.backlog` is `backlog add`, so the
 * backlog read has an id of its own.
 */
import { PRIORITY, answerOf, requestKey, type Client, type Outcome } from './client.js'
import { DEFAULT_STATUSES, type Row } from './index.js'

export const PROFILE = {
  status: 'buzzni.moai.status',
  prime: 'buzzni.moai.prime',
  show: 'buzzni.moai.show',
  add: 'buzzni.moai.add',
  showAll: 'buzzni.moai.show-all',
  backlog: 'buzzni.moai.backlog-all',
  showArchived: 'buzzni.moai.show-archived',
  showArchivedAfter: 'buzzni.moai.show-archived-after',
  wikiLs: 'buzzni.moai.wiki-ls',
  wikiShow: 'buzzni.moai.wiki-show',
  read: 'buzzni.moai.read',
  readAll: 'buzzni.moai.read-all',
  readGroup: 'buzzni.moai.read-group',
} as const

/** Rows per archive page; the `show-archived*` profiles fix `-n 200`. */
export const ARCHIVE_PAGE = 200

export interface Rows {
  rows: Row[]
  /** Rows the source knows of but did not list (prime's `rest` and `others_rest`). */
  more: number
  /** `show --all` was cut at the output limit, so these are prime's rows (and the backlog), not all of them. */
  truncated: boolean
}

export type Loaded<T> = { ok: true; value: T } | { ok: false; outcome: Outcome }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const items = (list: unknown): Row[] =>
  (Array.isArray(list) ? list : []).filter((item): item is Row => isRecord(item) && typeof item.id === 'string')

/**
 * A row without its references to groups (`epic`, `derived_epic`, `milestone`), for a set that holds no epics or
 * milestones: there such a reference cannot be placed, and kept, the index would file the row under (lost).
 */
function ungrouped(row: Row): Row {
  const { epic: _epic, derived_epic: _derivedEpic, milestone: _milestone, ...rest } = row
  return rest as Row
}

/**
 * `rows`, then the backlog's rows marked kind `backlog` whatever they say and passed through `adapt`. A backlog
 * row whose id `rows` already holds is left out; twins inside either list are all kept for the index.
 */
function withBacklog(rows: Row[], backlog: unknown, adapt: (row: Row) => Row = (row) => row): Row[] {
  const listed = new Set(rows.map((row) => row.id))
  return [...rows, ...items(backlog).filter((row) => !listed.has(row.id)).map((row) => adapt({ ...row, kind: 'backlog' }))]
}

/** prime lists what is held (picked: yours, others: other people's) and what can be picked up (ready). */
export function rowsFromPrime(output: unknown): Loaded<Rows> {
  if (!isRecord(output)) return { ok: false, outcome: { kind: 'unreadable' } }
  // Outside a `.moai/` repository prime reports no tracker instead of failing.
  if (output.no_tracker === true) return { ok: false, outcome: { kind: 'not-initialized' } }
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const item of [...items(output.picked), ...items(output.others), ...items(output.ready)]) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    // prime lists work rows only, never the epics and milestones they name, so the rows stand without those
    // references; `show --all` carries the groups too.
    rows.push(ungrouped({ ...item, kind: typeof item.kind === 'string' ? item.kind : 'issue' }))
  }
  return { ok: true, value: { rows, more: (Number(output.rest) || 0) + (Number(output.others_rest) || 0), truncated: false } }
}

/**
 * `show --all` and `backlog show --all` print a JSON array of rows; backlog rows are kind `backlog` whatever they
 * say. Twins (lines a merge left sharing one id) are not thinned out here: the index lets the later one win, as
 * moai does, and `show` prints them together, in file order when their priority ties.
 */
export function rowsFromLists(all: unknown, backlog: unknown): Loaded<Rows> {
  if (!Array.isArray(all) || !Array.isArray(backlog)) return { ok: false, outcome: { kind: 'unreadable' } }
  return { ok: true, value: { rows: withBacklog(items(all), backlog), more: 0, truncated: false } }
}

/** The index rows from `prime` alone: what is held and what is ready (the panel's reader until it switches). */
export async function loadRows(client: Client, priority: number = PRIORITY.list): Promise<Loaded<Rows>> {
  const outcome = await client.request(PROFILE.prime, undefined, { priority })
  return outcome.kind === 'passed' ? rowsFromPrime(outcome.output) : { ok: false, outcome }
}

/**
 * The index rows: `show --all` and `backlog show --all` read at once. A failure of either is the load's failure
 * (`show --all` first). When `show --all` was cut at the output limit, prime's rows stand in with
 * `truncated: true`, plus the backlog when that read, without its references to the groups prime leaves out.
 */
export async function loadAllRows(client: Client, priority: number = PRIORITY.list): Promise<Loaded<Rows>> {
  const listing = client.request(PROFILE.showAll, undefined, { priority })
  const reading = client.request(PROFILE.backlog, undefined, { priority })
  const all = await listing
  const cut = all.kind === 'unreadable' && all.truncated === true
  if (!cut && answerOf(all) === undefined) {
    // show --all alone decides this load (declined, no tracker): a backlog read still queued behind it
    // would only open a second confirmation for a load that already failed.
    client.cancel(requestKey(PROFILE.backlog))
    return { ok: false, outcome: all }
  }
  const backlog = await reading
  if (cut) {
    const loaded = await loadRows(client, priority)
    if (!loaded.ok) return loaded
    return { ok: true, value: { rows: withBacklog(loaded.value.rows, answerOf(backlog), ungrouped), more: loaded.value.more, truncated: true } }
  }
  const listed = answerOf(all)
  if (listed === undefined) return { ok: false, outcome: all }
  const thoughts = answerOf(backlog)
  if (thoughts === undefined) return { ok: false, outcome: backlog }
  return rowsFromLists(listed, thoughts)
}

/**
 * The column names in the order `.moai/config.toml` gives them. ASSUMED upstream shape: `status --json`
 * carries `statuses: string[]`. Moai 0.16 does not yet; its `counts` keys are every column (empty ones
 * too) but alphabetical, so they are put in the default order with the unknown ones after. Outside a
 * `.moai/` repository `status` lists the registered projects instead of counts.
 */
export function statusesFrom(output: unknown): Loaded<string[]> {
  if (!isRecord(output)) return { ok: false, outcome: { kind: 'unreadable' } }
  if (Array.isArray(output.projects) && output.counts === undefined) return { ok: false, outcome: { kind: 'not-initialized' } }
  const listed = output.statuses
  if (Array.isArray(listed) && listed.length > 0 && listed.every((name) => typeof name === 'string' && name.length > 0)) {
    return { ok: true, value: [...new Set(listed as string[])] }
  }
  if (!isRecord(output.counts) || Array.isArray(output.counts)) return { ok: false, outcome: { kind: 'unreadable' } }
  const names = Object.keys(output.counts)
  const known = DEFAULT_STATUSES.filter((name) => names.includes(name))
  return { ok: true, value: [...known, ...names.filter((name) => !DEFAULT_STATUSES.includes(name))] }
}

export async function loadStatuses(client: Client, priority: number = PRIORITY.list): Promise<Loaded<string[]>> {
  const outcome = await client.request(PROFILE.status, undefined, { priority })
  const output = answerOf(outcome)
  return output === undefined ? { ok: false, outcome } : statusesFrom(output)
}

export interface ArchiveOptions {
  /** Each page as it arrives, so the view can show rows before the last page. */
  onPage?: (rows: Row[]) => void
  /** Asked between pages; true stops the paging with a `cancelled` outcome. */
  cancelled?: () => boolean
  priority?: number
}

/**
 * Every row the archive holds, read `show --archived -n 200 --sort id` and then `--after <last id>` until a
 * page comes back shorter than 200. (`--after ''` is refused by Moai, so the first page is its own profile.)
 * `--archived` lists the active rows too; the caller keeps whichever it needs. A failed page stops the
 * paging with its outcome; the pages before it have already gone to `onPage`.
 */
export async function loadArchived(client: Client, options: ArchiveOptions = {}): Promise<Loaded<Row[]>> {
  const priority = options.priority ?? PRIORITY.background
  const rows: Row[] = []
  let after: string | undefined
  for (;;) {
    if (options.cancelled?.()) return { ok: false, outcome: { kind: 'cancelled', mayContinue: false } }
    const outcome = after === undefined
      ? await client.request(PROFILE.showArchived, undefined, { priority })
      : await client.request(PROFILE.showArchivedAfter, after, { priority })
    const output = answerOf(outcome)
    if (output === undefined) return { ok: false, outcome }
    if (!Array.isArray(output)) return { ok: false, outcome: { kind: 'unreadable' } }
    const page = items(output)
    rows.push(...page)
    if (page.length > 0) options.onPage?.(page)
    const last = page.at(-1)?.id
    // A short page is the end; so is a page that would not move the cursor on.
    if (output.length < ARCHIVE_PAGE || last === undefined || last === after) return { ok: true, value: rows }
    after = last
  }
}

/** `moai wiki ls` as printed (a skipped page's partial answer included); the wiki view parses it. */
export async function loadWikiListing(client: Client): Promise<Loaded<unknown>> {
  const outcome = await client.request(PROFILE.wikiLs, undefined, { priority: PRIORITY.wiki })
  const output = answerOf(outcome)
  return output === undefined ? { ok: false, outcome } : { ok: true, value: output }
}

/** `moai wiki show <slug>` as printed; the wiki view parses it. */
export async function loadWikiPage(client: Client, slug: string): Promise<Loaded<unknown>> {
  const outcome = await client.request(PROFILE.wikiShow, slug, { priority: PRIORITY.wiki })
  const output = answerOf(outcome)
  return output === undefined ? { ok: false, outcome } : { ok: true, value: output }
}

/** One row with its body, children and journal (`moai show <id>`). */
export async function loadDetail(client: Client, id: string): Promise<Loaded<Row>> {
  const outcome = await client.request(PROFILE.show, id, { priority: PRIORITY.detail })
  if (outcome.kind !== 'passed') return { ok: false, outcome }
  return isRecord(outcome.output) && typeof outcome.output.id === 'string' ? { ok: true, value: outcome.output as Row } : { ok: false, outcome: { kind: 'unreadable' } }
}

export async function addTask(client: Client, title: string): Promise<Loaded<Row>> {
  const outcome = await client.request(PROFILE.add, title, { priority: PRIORITY.detail, share: false })
  if (outcome.kind !== 'passed') return { ok: false, outcome }
  return isRecord(outcome.output) && typeof outcome.output.id === 'string' ? { ok: true, value: outcome.output as Row } : { ok: false, outcome: { kind: 'unreadable' } }
}
