/**
 * What the detail pane says, as plain data: the head line, the labeled fields, a blocker's state, a group's
 * roll-up, and one line each for a commit, a journal entry and a work record. No DOM here; view/detail.ts
 * draws it and tests/moai-e3-detail.test.mjs checks it.
 */
import { isDone, isGroup, type IssueIndex, type Progress, type Row } from '../data/index.ts'
import type { Outcome } from '../data/client.ts'
import type { Copy } from '../i18n/index.ts'

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const text = (value: unknown): string => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '')
const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : [])

/** `YYYY-MM-DD HH:MM` in the host's time zone; '' for anything that is not a date. */
export function formatDate(value: unknown): string {
  // A bare date (a due day) has no time zone to move it into.
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const date = new Date(typeof value === 'string' ? value : NaN)
  if (Number.isNaN(date.getTime())) return ''
  const two = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
}

export type Tone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

/** The status chip's tone: done is calm, work in flight is accent, review asks for attention. */
export function statusTone(status: unknown): Tone {
  if (status === 'done') return 'ok'
  if (status === 'in_progress') return 'accent'
  if (status === 'review') return 'warn'
  return 'neutral'
}

export interface Head {
  id: string
  title: string
  status: string
  statusLabel: string
  tone: Tone
  /** `P2`, or '' when the row carries none. */
  priority: string
  /** `epic`, `task`… — the kind's name; '' for the common case of a plain task. */
  kind: string
  /** Why it is put off, or '' when it is not. */
  deferred: string
}

export function headOf(row: Row, copy: Copy): Head {
  // A group's own state is read from its members; `derived_status` is what the list shows for it.
  const status = text(isGroup(row) ? row.derived_status ?? row.status : row.status)
  const kind = text(row.kind)
  return {
    id: row.id,
    title: text(row.title) || row.id,
    status,
    statusLabel: copy.stats[status] ?? status,
    tone: statusTone(status),
    priority: typeof row.priority === 'number' ? copy.detail.priority(row.priority) : '',
    kind: kind && kind !== 'issue' ? copy.detail.kinds[kind] ?? kind : '',
    deferred: text(row.deferred_at) && !isDone(row) ? text(row.deferred_reason) || formatDate(row.deferred_at) || copy.detail.deferred : '',
  }
}

export type BlockerState = 'done' | 'open' | 'deferred' | 'missing'

/** One blocker: ✓ finished, · open, put off, or an id the index does not hold. */
export function blockerState(id: string, index: IssueIndex | null): BlockerState {
  const at = index?.find(id)
  if (at === undefined) return 'missing'
  const row = index!.rows[at]!
  if (isDone(row)) return 'done'
  return index!.shelvedAt(at) !== undefined ? 'deferred' : 'open'
}

export const BLOCKER_MARK: Record<BlockerState, string> = { done: '✓', open: '·', deferred: '⏸', missing: '?' }

/** What blocks the row, from its own `blocked_by`. */
export const blockedByOf = (row: Row): string[] => strings(row.blocked_by)

/** The rows that name this one in their `blocked_by`, plus the ids `show` says it blocks. */
export function blocksOf(row: Row, index: IssueIndex | null): string[] {
  const out = new Set(strings(row.blocks))
  for (const other of index?.rows ?? []) if (blockedByOf(other).includes(row.id)) out.add(other.id)
  return [...out]
}

export interface Rollup {
  done: number
  work: number
  percent: number | undefined
  /** Counts per status of the work rows, in the order the statuses first appear. */
  byStatus: [string, number][]
}

/** `n/n` for a group, from the index the list uses — the same count. Null for anything that is not a group. */
export function rollupOf(row: Row, index: IssueIndex | null): Rollup | null {
  if (!index || !isGroup(row)) return null
  const at = index.find(row.id)
  if (at === undefined) return null
  const progress: Progress = index.progress(index.dirPath(at))
  const counts = new Map<string, number>()
  for (const work of progress.work) {
    const status = text(index.rows[work]!.status) || 'todo'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const total = progress.work.length
  return { done: progress.done, work: total, percent: total ? Math.floor((progress.done * 100) / total) : undefined, byStatus: [...counts] }
}

export interface Field {
  key: string
  label: string
  value: string
}

/** The labeled fields under the head line, in the TUI's order; one that has no value is left out. */
export function fieldsOf(row: Row, index: IssueIndex | null, copy: Copy): Field[] {
  const d = copy.detail
  const epic = text(row.epic) || text(row.derived_epic)
  const milestone = text(row.milestone)
  const titled = (id: string) => {
    const at = index?.find(id)
    const title = at === undefined ? '' : text(index!.rows[at]!.title)
    return title ? `${title} (${id})` : id
  }
  const assignee = text(row.assignee)
  const email = text(row.assignee_email)
  const all: [string, string, string][] = [
    ['assignee', d.assignee, assignee && email && email !== assignee ? `${assignee} <${email}>` : assignee || email],
    ['epic', d.epic, epic ? titled(epic) : ''],
    ['milestone', d.milestone, milestone ? titled(milestone) : ''],
    ['due', d.due, formatDate(row.due)],
    ['created', d.created, formatDate(row.created_at)],
    ['updated', d.updated, formatDate(row.updated_at)],
    ['started', d.started, formatDate(row.started_at)],
    ['ended', d.ended, formatDate(row.done_at ?? row.ended_at)],
  ]
  return all.filter(([, , value]) => value).map(([key, label, value]) => ({ key, label, value }))
}

export const tagsOf = (row: Row): string[] => strings(row.tags)

/** A commit as `show` prints it: a bare hash, or an object with a hash and a subject. */
export function commitLine(item: unknown): { hash: string; subject: string } | null {
  if (typeof item === 'string') return item ? { hash: item.slice(0, 7), subject: '' } : null
  if (!isRecord(item)) return null
  const hash = text(item.hash) || text(item.sha) || text(item.commit) || text(item.id)
  const subject = text(item.subject) || text(item.title) || text(item.message)
  return hash || subject ? { hash: hash.slice(0, 7), subject: subject.split('\n')[0]! } : null
}

export interface JournalLine {
  /** `create`, `note`, `status`, or whatever moai wrote. */
  kind: string
  text: string
  meta: string
}

/** One journal entry: what happened, then who and when. */
export function journalLine(entry: unknown, copy: Copy): JournalLine | null {
  if (!isRecord(entry)) return null
  const kind = text(entry.kind)
  let said: string
  if (kind === 'create') said = copy.detail.created_entry
  else if (kind === 'status') {
    const from = text(entry.from)
    const to = text(entry.to)
    said = `${copy.stats[from] ?? from} → ${copy.stats[to] ?? to}`
  } else said = text(entry.text) || kind
  return { kind, text: said, meta: [text(entry.by), formatDate(entry.ts)].filter(Boolean).join(' · ') }
}

/** The journal as the file keeps it: oldest first, so it reads top to bottom. */
export function journalOf(row: Row, copy: Copy): JournalLine[] {
  return (Array.isArray(row.journal) ? row.journal : []).map((entry) => journalLine(entry, copy)).filter((line): line is JournalLine => line !== null)
}

export function commitsOf(row: Row): { hash: string; subject: string }[] {
  return (Array.isArray(row.commits) ? row.commits : []).map(commitLine).filter((line): line is { hash: string; subject: string } => line !== null)
}

/** A work record (an AI run's note) as one line; its shape is not fixed, so it takes what reads as text. */
export function workLine(item: unknown): string {
  if (typeof item === 'string') return item
  if (!isRecord(item)) return ''
  const main = text(item.summary) || text(item.text) || text(item.title) || text(item.note) || text(item.kind)
  const who = text(item.by) || text(item.agent) || text(item.model)
  const when = formatDate(item.ts ?? item.at)
  return [main, [who, when].filter(Boolean).join(' · ')].filter(Boolean).join('  ')
}

export const workOf = (row: Row): string[] => (Array.isArray(row.work) ? row.work : []).map(workLine).filter(Boolean)

/** The subtasks `show` lists under the row, by id. */
export function childrenOf(row: Row): Row[] {
  return (Array.isArray(row.children) ? row.children : []).filter((child): child is Row => isRecord(child) && typeof child.id === 'string')
}

/** Why a read failed, in the words the shell uses for the same outcome; null for one that passed. */
export function problemText(outcome: Outcome, copy: Copy): string | null {
  switch (outcome.kind) {
    case 'refused': return copy.refused[outcome.code]
    case 'not-initialized': return `${copy.notInitialized[0]}moai init${copy.notInitialized[1]}`
    case 'moai-error': return copy.moaiError(outcome.message)
    case 'cancelled': return outcome.mayContinue ? `${copy.cancelled} ${copy.mayContinue}` : copy.cancelled
    case 'unreadable': return copy.unreadable
    case 'not-started': return copy.notStarted
    case 'failed': return copy.failed
    case 'passed': return null
  }
}
