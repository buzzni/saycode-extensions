/**
 * Where the panel's data comes from: one function per Moai read, each handing out plain values or the
 * {@link Outcome} that stopped it. Nothing above this module knows which profile answered.
 *
 * - The index rows come from `show --all` (active rows, done and deferred included, archive left out) and
 *   `backlog show`, read side by side ({@link loadAllRows}). If the daemon cut `show --all` at the 1 MiB
 *   output limit the rows fall back to `prime` (what is held and what is ready) with `truncated: true`, so
 *   the view can say the list is partial.
 * - {@link loadRows}, which the panel boots with today, still reads `prime` alone: the board's jsdom tests
 *   (tests/moai.test.mjs) and main.ts answer only `prime`, and both are held by other work. Switching is
 *   main.ts calling {@link loadAllRows} (same arguments, same `Loaded<Rows>`) once those tests answer
 *   `show-all` and `backlog`.
 * - The column names come from `status` ({@link loadStatuses}).
 * - The archive is read page by page, 200 rows sorted by id, only when asked for ({@link loadArchived}).
 * - The wiki listing and pages are handed out as Moai printed them ({@link loadWikiListing},
 *   {@link loadWikiPage}); the wiki view parses them.
 *
 * These profiles are the ones the manifest declares; the Happy daemon's catalog is assumed to carry the
 * same (se-0g4a.anz) until it is checked live.
 */
import { PRIORITY, type Client, type Outcome } from './client.js'
import type { Row } from './index.js'

export const PROFILE = {
  status: 'buzzni.moai.status',
  prime: 'buzzni.moai.prime',
  show: 'buzzni.moai.show',
  add: 'buzzni.moai.add',
  showAll: 'buzzni.moai.show-all',
  backlog: 'buzzni.moai.backlog',
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

/** Moai's default columns, the order used when `status` does not say its own. */
export const DEFAULT_STATUSES = ['todo', 'in_progress', 'review', 'done'] as const

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
    const row: Row = { ...item, kind: typeof item.kind === 'string' ? item.kind : 'issue' }
    // prime lists work rows only, never the epics and milestones they name (`epic`, `derived_epic`), so such a
    // reference cannot be placed here: kept, the index would file every member of an epic under (lost). The
    // rows stand without them; `show --all` carries the groups too.
    delete row.epic
    delete row.derived_epic
    delete row.milestone
    rows.push(row)
  }
  return { ok: true, value: { rows, more: (Number(output.rest) || 0) + (Number(output.others_rest) || 0), truncated: false } }
}

/** `show --all` and `backlog show` print a JSON array of rows; backlog rows are kind `backlog` whatever they say. */
export function rowsFromLists(all: unknown, backlog: unknown): Loaded<Rows> {
  if (!Array.isArray(all) || !Array.isArray(backlog)) return { ok: false, outcome: { kind: 'unreadable' } }
  const seen = new Set<string>()
  const rows: Row[] = []
  for (const item of items(all)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    rows.push(item)
  }
  for (const item of items(backlog)) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    rows.push({ ...item, kind: 'backlog' })
  }
  return { ok: true, value: { rows, more: 0, truncated: false } }
}

/** The index rows from `prime` alone: what is held and what is ready (the panel's reader until it switches). */
export async function loadRows(client: Client, priority: number = PRIORITY.list): Promise<Loaded<Rows>> {
  const outcome = await client.request(PROFILE.prime, undefined, { priority })
  return outcome.kind === 'passed' ? rowsFromPrime(outcome.output) : { ok: false, outcome }
}

/**
 * The index rows: `show --all` and `backlog show` read at once. A failure of either is the load's failure
 * (`show --all` first). When `show --all` was cut at the output limit, prime's rows stand in with
 * `truncated: true`, plus the backlog when that read whole.
 */
export async function loadAllRows(client: Client, priority: number = PRIORITY.list): Promise<Loaded<Rows>> {
  const [all, backlog] = await Promise.all([
    client.request(PROFILE.showAll, undefined, { priority }),
    client.request(PROFILE.backlog, undefined, { priority }),
  ])
  if (all.kind === 'unreadable' && all.truncated) {
    const prime = await client.request(PROFILE.prime, undefined, { priority })
    if (prime.kind !== 'passed') return { ok: false, outcome: prime }
    const loaded = rowsFromPrime(prime.output)
    if (!loaded.ok) return loaded
    const extra = backlog.kind === 'passed' && Array.isArray(backlog.output) ? rowsFromLists([], backlog.output) : null
    const known = new Set(loaded.value.rows.map((row) => row.id))
    const rows = [...loaded.value.rows, ...(extra?.ok ? extra.value.rows.filter((row) => !known.has(row.id)) : [])]
    return { ok: true, value: { rows, more: loaded.value.more, truncated: true } }
  }
  if (all.kind !== 'passed') return { ok: false, outcome: all }
  if (backlog.kind !== 'passed') return { ok: false, outcome: backlog }
  return rowsFromLists(all.output, backlog.output)
}

/**
 * The column names in the order `.moai/config.toml` gives them. ASSUMED upstream shape: `status --json`
 * carries `statuses: string[]`. Moai 0.16 does not yet; its `counts` keys are every column (empty ones
 * too) but alphabetical, so they are put in the default order with the unknown ones after.
 */
export function statusesFrom(output: unknown): Loaded<string[]> {
  if (!isRecord(output)) return { ok: false, outcome: { kind: 'unreadable' } }
  const listed = output.statuses
  if (Array.isArray(listed) && listed.length > 0 && listed.every((name) => typeof name === 'string' && name.length > 0)) {
    return { ok: true, value: [...new Set(listed as string[])] }
  }
  if (!isRecord(output.counts)) return { ok: false, outcome: { kind: 'unreadable' } }
  const names = Object.keys(output.counts)
  const known = DEFAULT_STATUSES.filter((name) => names.includes(name))
  return { ok: true, value: [...known, ...names.filter((name) => !(DEFAULT_STATUSES as readonly string[]).includes(name))] }
}

export async function loadStatuses(client: Client, priority: number = PRIORITY.list): Promise<Loaded<string[]>> {
  const outcome = await client.request(PROFILE.status, undefined, { priority })
  return outcome.kind === 'passed' ? statusesFrom(outcome.output) : { ok: false, outcome }
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
    if (outcome.kind !== 'passed') return { ok: false, outcome }
    if (!Array.isArray(outcome.output)) return { ok: false, outcome: { kind: 'unreadable' } }
    const page = items(outcome.output)
    rows.push(...page)
    if (page.length > 0) options.onPage?.(page)
    const last = page.at(-1)?.id
    // A short page is the end; so is a page that would not move the cursor on.
    if (outcome.output.length < ARCHIVE_PAGE || last === undefined || last === after) return { ok: true, value: rows }
    after = last
  }
}

/** `moai wiki ls` as printed; the wiki view parses it. */
export async function loadWikiListing(client: Client): Promise<Loaded<unknown>> {
  const outcome = await client.request(PROFILE.wikiLs, undefined, { priority: PRIORITY.wiki })
  return outcome.kind === 'passed' ? { ok: true, value: outcome.output } : { ok: false, outcome }
}

/** `moai wiki show <slug>` as printed; the wiki view parses it. */
export async function loadWikiPage(client: Client, slug: string): Promise<Loaded<unknown>> {
  const outcome = await client.request(PROFILE.wikiShow, slug, { priority: PRIORITY.wiki })
  return outcome.kind === 'passed' ? { ok: true, value: outcome.output } : { ok: false, outcome }
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
