/**
 * Where the panel's data comes from. Today that is the four profiles the Happy daemon's Moai v0.8.0
 * catalog carries (`status`, `prime`, `show`, `add`); the rows for the index come from `prime`.
 *
 * Once the daemon catalog adds `show --all` and `backlog show` (se-0g4a.anz, se-89fu.ca6), {@link loadRows}
 * reads those instead and the index gets milestones, epics and done rows. Nothing above this module needs
 * to change for that: it hands out plain {@link Row}s.
 */
import { PRIORITY, type Client, type Outcome } from './client.js'
import type { Row } from './index.js'

export const PROFILE = {
  status: 'buzzni.moai.status',
  prime: 'buzzni.moai.prime',
  show: 'buzzni.moai.show',
  add: 'buzzni.moai.add',
} as const

export interface Rows {
  rows: Row[]
  /** Rows the source knows of but did not list (prime's `rest` and `others_rest`). */
  more: number
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
    rows.push({ ...item, kind: typeof item.kind === 'string' ? item.kind : 'issue' })
  }
  return { ok: true, value: { rows, more: (Number(output.rest) || 0) + (Number(output.others_rest) || 0) } }
}

export async function loadRows(client: Client, priority: number = PRIORITY.list): Promise<Loaded<Rows>> {
  const outcome = await client.request(PROFILE.prime, undefined, { priority })
  return outcome.kind === 'passed' ? rowsFromPrime(outcome.output) : { ok: false, outcome }
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
