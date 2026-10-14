/**
 * Where the panel's data comes from: one function per Moai read, each handing out plain values or the
 * {@link Outcome} that stopped it. Nothing above this module knows which profile answered.
 *
 * - The index rows come from `show --all` (active rows, done and deferred included, archive left out) and
 *   `backlog show --all` (the backlog the same way), read side by side ({@link loadAllRows}). The archive is
 *   Moai's clock too (a row done for `archive_days`), so a group's old done members are not among these rows
 *   until the archive is read. If the daemon cut `show --all` at the 1 MiB output limit the rows fall back to
 *   `prime` (what is held and what is ready) with `truncated: true`, so the view can say the list is partial.
 * - main.ts boots on {@link loadAllRows} and keeps `truncated` in the board state for its banner; in the
 *   fallback `more` counts only what prime held back, not what `show --all` would have listed.
 *   {@link loadRows} reads `prime` alone and is that fallback.
 * - A partial answer (Moai's non-zero exit with its whole JSON still printed; see client.ts) is read like a
 *   whole one: the rows it could read, the wiki pages it did not skip. `prime` ends such a run with 0 itself.
 * - The column names come from `status` ({@link loadStatuses}). Nothing asks for them yet: the board orders its
 *   columns from DEFAULT_STATUSES and the statuses its rows carry (view/board-groups.ts statusKeys).
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
import type { CompatProbe } from './compat.js'
import { DEFAULT_STATUSES, standsDone, type Row } from './index.js'

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

/** Hands a request's outcome to the compatibility probe, when the caller keeps one (compat.ts). */
function seen(probe: CompatProbe | undefined, profile: string, outcome: Outcome): Outcome {
  probe?.observe(profile, outcome)
  return outcome
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
  // `rest` and `others_rest` count over what the running milestone let through; the ids it left out stand in
  // `outside` and are counted nowhere else, so a milestone whose members are all blocked reads as "nothing here".
  const outside = Array.isArray(output.outside) ? output.outside.length : 0
  return { ok: true, value: { rows, more: (Number(output.rest) || 0) + (Number(output.others_rest) || 0) + outside, truncated: false } }
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

/** The index rows from `prime` alone: what is held and what is ready (loadAllRows' fallback when `show --all` was cut). */
export async function loadRows(client: Client, priority: number = PRIORITY.list, probe?: CompatProbe): Promise<Loaded<Rows>> {
  const outcome = seen(probe, PROFILE.prime, await client.request(PROFILE.prime, undefined, { priority }))
  return outcome.kind === 'passed' ? rowsFromPrime(outcome.output) : { ok: false, outcome }
}

/**
 * The index rows: `show --all` and `backlog show --all` read at once. A failure of either is the load's failure
 * (`show --all` first). When `show --all` was cut at the output limit, prime's rows stand in with
 * `truncated: true`, plus the backlog when that read, without its references to the groups prime leaves out.
 */
export async function loadAllRows(client: Client, priority: number = PRIORITY.list, probe?: CompatProbe): Promise<Loaded<Rows>> {
  const listing = client.request(PROFILE.showAll, undefined, { priority })
  const reading = client.request(PROFILE.backlog, undefined, { priority })
  const all = seen(probe, PROFILE.showAll, await listing)
  const cut = all.kind === 'unreadable' && all.truncated === true
  if (!cut && answerOf(all) === undefined) {
    // show --all alone decides this load (declined, no tracker): the backlog read is called off. One still queued
    // ends at once; one already starting beside it (the panel runs up to 3 reads at once) is cancelled as soon as
    // it is accepted, though its confirmation may already be showing.
    client.cancel(requestKey(PROFILE.backlog))
    // A read that already ended keeps its outcome, and compat learns it; a cancelled one says nothing.
    // Not awaited: the panel does not wait on a read it no longer wants. The probe tells its listeners when the
    // outcome lands, after this load has ended (main.ts puts the report in the store then).
    if (probe) void reading.then((outcome) => probe.observe(PROFILE.backlog, outcome))
    return { ok: false, outcome: all }
  }
  const backlog = seen(probe, PROFILE.backlog, await reading)
  if (cut) {
    const loaded = await loadRows(client, priority, probe)
    if (!loaded.ok) return loaded
    return { ok: true, value: { rows: withBacklog(loaded.value.rows, answerOf(backlog), ungrouped), more: loaded.value.more, truncated: true } }
  }
  const listed = answerOf(all)
  if (listed === undefined) return { ok: false, outcome: all }
  const thoughts = answerOf(backlog)
  if (thoughts === undefined) return { ok: false, outcome: backlog }
  const loaded = rowsFromLists(listed, thoughts)
  if (loaded.ok) probe?.observeRows(loaded.value.rows)
  return loaded
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

/**
 * `[done, total]` per milestone and epic id from `status --json` (`milestones[]` and `epics[]`). These count the
 * rows the clock has archived too, which `show --all` omits; hand the map to `new IssueIndex(rows, tallies)` so
 * the board's n/n equals `moai status`. Entries without a string id and numeric `done` and `total` are skipped.
 */
export function talliesFrom(output: unknown): Map<string, [number, number]> {
  const tallies = new Map<string, [number, number]>()
  if (!isRecord(output)) return tallies
  for (const list of [output.milestones, output.epics]) {
    if (!Array.isArray(list)) continue
    for (const entry of list) {
      if (!isRecord(entry) || typeof entry.id !== 'string' || entry.id === '') continue
      const { done, total } = entry
      if (typeof done !== 'number' || typeof total !== 'number' || !Number.isFinite(done) || !Number.isFinite(total)) continue
      tallies.set(entry.id, [done, total])
    }
  }
  return tallies
}

/** Two {@link talliesFrom} maps that give every milestone and epic the same `[done, total]`. */
export function sameTallies(a: ReadonlyMap<string, readonly [number, number]>, b: ReadonlyMap<string, readonly [number, number]> | undefined): boolean {
  if (!b || a.size !== b.size) return false
  for (const [id, [done, total]] of a) {
    const other = b.get(id)
    if (!other || other[0] !== done || other[1] !== total) return false
  }
  return true
}

/** The same `status` request as {@link loadStatuses}, which the client shares; read once, used for both. */
export async function loadTallies(client: Client, priority: number = PRIORITY.list, probe?: CompatProbe): Promise<Loaded<Map<string, [number, number]>>> {
  const outcome = seen(probe, PROFILE.status, await client.request(PROFILE.status, undefined, { priority }))
  const output = answerOf(outcome)
  if (output !== undefined) probe?.observeStatus(output)
  return output === undefined ? { ok: false, outcome } : { ok: true, value: talliesFrom(output) }
}

export async function loadStatuses(client: Client, priority: number = PRIORITY.list, probe?: CompatProbe): Promise<Loaded<string[]>> {
  const outcome = seen(probe, PROFILE.status, await client.request(PROFILE.status, undefined, { priority }))
  const output = answerOf(outcome)
  if (output !== undefined) probe?.observeStatus(output)
  return output === undefined ? { ok: false, outcome } : statusesFrom(output)
}

export interface ArchiveOptions {
  /** Each page as it arrives, so the view can show rows before the last page. */
  onPage?: (rows: Row[]) => void
  /** Asked between pages; true stops the paging with a `cancelled` outcome. */
  cancelled?: () => boolean
  priority?: number
  /** Told each page's outcome (compat.ts). */
  probe?: CompatProbe
  /**
   * Ids of the active rows already held (`show --all`). `--archived` lists active rows too, and `moai read`
   * resolves only active rows, so a row whose id is not here is tagged `archived: true` (read.ts then never
   * draws NEW on it, se-fvou). Without this the rows are returned untagged.
   */
  active?: ReadonlySet<string>
}

/** `rows` with `archived: true` on those whose id is not in `active`. */
export function markArchived(rows: readonly Row[], active: ReadonlySet<string>): Row[] {
  return rows.map((row) => (active.has(row.id) ? row : { ...row, archived: true }))
}

/** The rows a list read stands on, and whether `show --all` was cut ({@link Rows}). */
export type Listed = Pick<Rows, 'rows'> & { truncated?: boolean }

/**
 * The ids of the active rows, to tell the archive's archive-only rows by: `--archived` lists the active rows too,
 * and its rows carry no mark of their own. A whole list holds every active row. A cut one (`truncated`: prime's
 * rows) does not, so absence from it is not taken as archived: moai archives only rows that stood done for
 * `archive_days`, so an archive row in any other column is active. The column is the one the row stands in: a
 * group's is its members' (`derived_status`), as moai archives it — the status written on a group does not follow
 * them. A done one is still tagged — at worst a row done lately draws no NEW and takes no read mark until the whole
 * list reads again, where an archived row left untagged would offer a read mark `moai read` refuses.
 */
export function activeIds(listed: Listed, archive: readonly Row[] = []): Set<string> {
  const active = new Set(listed.rows.map((row) => row.id))
  if (listed.truncated) for (const row of archive) if (!standsDone(row)) active.add(row.id)
  return active
}

/**
 * The listed rows, then the archive's rows they do not hold (only while archived rows are shown), tagged
 * `archived: true` against the rows held now: a row the clock archived after the archive was read left `show --all`
 * and is in the archive's answer untagged (it was active then), and it stays in the list as an archived row.
 */
export function withArchive(listed: Listed, archive: readonly Row[] | null): Row[] {
  const { rows } = listed
  if (!archive) return rows
  const held = new Set(rows.map((row) => row.id))
  const away = markArchived(archive, activeIds(listed, archive)).filter((row) => !held.has(row.id))
  return away.length ? [...rows, ...away] : rows
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
    const profile = after === undefined ? PROFILE.showArchived : PROFILE.showArchivedAfter
    const outcome = seen(options.probe, profile, await client.request(profile, after, { priority }))
    const output = answerOf(outcome)
    if (output === undefined) return { ok: false, outcome }
    if (!Array.isArray(output)) return { ok: false, outcome: { kind: 'unreadable' } }
    const page = options.active ? markArchived(items(output), options.active) : items(output)
    rows.push(...page)
    if (page.length > 0) options.onPage?.(page)
    const last = page.at(-1)?.id
    // A short page is the end; so is a page that would not move the cursor on.
    if (output.length < ARCHIVE_PAGE || last === undefined || last === after) return { ok: true, value: rows }
    after = last
  }
}

/** `moai wiki ls` as printed (a skipped page's partial answer included); the wiki view parses it. */
export async function loadWikiListing(client: Client, probe?: CompatProbe): Promise<Loaded<unknown>> {
  const outcome = seen(probe, PROFILE.wikiLs, await client.request(PROFILE.wikiLs, undefined, { priority: PRIORITY.wiki }))
  const output = answerOf(outcome)
  return output === undefined ? { ok: false, outcome } : { ok: true, value: output }
}

/** `moai wiki show <slug>` as printed; the wiki view parses it. */
export async function loadWikiPage(client: Client, slug: string, probe?: CompatProbe): Promise<Loaded<unknown>> {
  const outcome = seen(probe, PROFILE.wikiShow, await client.request(PROFILE.wikiShow, slug, { priority: PRIORITY.wiki }))
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
