/**
 * Compatibility: what the panel can tell about the `moai` CLI and the Happy daemon's catalog from what they
 * answered, so a banner can say "upgrade moai" or "update the daemon catalog" instead of a broken screen.
 * No DOM here, and nothing in this module asks anything: loaders hand it the outcomes and shapes they already
 * read ({@link CompatProbe}), and {@link CompatProbe.report} judges them. The banner is drawn elsewhere.
 *
 * Extension and moai versions are independent (README, Compatibility); the extension assumes upstream
 * improvements (se-0g4a) and a catalog of 13 profiles (se-0g4a.anz). Features that still work keep working:
 * the fallbacks are in source.ts, this only names which ones are in use.
 *
 * What is evidence of what:
 * - `refused` `unsupported-daemon` on a profile: the daemon's catalog does not have it (or the daemon is too
 *   old for the machine run at all, when the baseline profiles refuse too: the catalog is then `unknown`
 *   as a whole, not 13 missing ones). `tool-missing`: `moai` is not installed there.
 * - A start that failed comes back `not-started` (client.ts), with the code it named when it named one: an older
 *   host may name `unsupported-daemon` in a thrown start's message, which is read as the refusal is. A profile
 *   read as missing stays so until one pass of the same profile clears it. `binding-mismatch` (a refusal the
 *   panel does not list; the extension answers every SDK refusal code, src/index.ts) says the binding or the
 *   approval changed, nothing of the catalog: it counts as a start that failed, as one naming no code does.
 * - The shape of `status --json` is the strong sign of an old moai: new moai prints `statuses[]` and the
 *   `milestones[]`/`epics[]` tallies, old moai (0.16) prints `counts` and no `statuses`. The `unread` key on
 *   rows is weak: it is absent for a person it does not know and when nothing is unread, so rows without it
 *   alone say `unknown`, never `old`.
 * - `degraded` names only what the panel uses ({@link ORDER}): moai 0.16 prints the tallies, and what it lacks
 *   (`statuses[]`, maybe `unread`) serves nothing drawn yet, so a 0.16 reads `old` with nothing degraded.
 */
import type { Outcome } from './client.js'
import type { Row } from './index.js'
import { PROFILE } from './source.js'

export type Feature = 'all-rows' | 'backlog' | 'archive' | 'wiki' | 'read-marks' | 'unread' | 'status-order' | 'tallies'

export interface CompatReport {
  /** `old`: a shape only an older moai prints. `unknown`: nothing seen decides it (or `moai` is missing). */
  moai: 'ok' | 'old' | 'unknown'
  /** `moai` is not installed where the daemon runs: a `tool-missing` refusal, and no run started there since. */
  toolMissing: boolean
  catalog: {
    /** `missing`: `missing` names profile ids; `unknown`: nothing asked yet, or the daemon refused everything. */
    state: 'ok' | 'missing' | 'unknown'
    missing: string[]
  }
  /** Features the panel uses that run on a fallback or are off, in a fixed order. */
  degraded: Feature[]
}

/** The profiles a daemon of the shipped catalog already has (source.ts header); the rest are the assumed ones. */
const BASELINE: ReadonlySet<string> = new Set([PROFILE.status, PROFILE.prime, PROFILE.show, PROFILE.add, PROFILE.wikiLs, PROFILE.wikiShow])

const FEATURE_OF: Readonly<Record<string, Feature>> = {
  [PROFILE.showAll]: 'all-rows',
  [PROFILE.backlog]: 'backlog',
  [PROFILE.showArchived]: 'archive',
  [PROFILE.showArchivedAfter]: 'archive',
  [PROFILE.wikiLs]: 'wiki',
  [PROFILE.wikiShow]: 'wiki',
  [PROFILE.read]: 'read-marks',
  [PROFILE.readAll]: 'read-marks',
  [PROFILE.readGroup]: 'read-marks',
}

/**
 * The features the panel uses, in the banner's order; one judged off that is not here is left out of `degraded`.
 * `unread` (NEW marks: read.ts isUnread) and `status-order` (the columns from `status`: source.ts loadStatuses)
 * are told apart below but have no callers yet: put one back here when it is drawn.
 */
const ORDER: readonly Feature[] = ['all-rows', 'backlog', 'archive', 'wiki', 'read-marks', 'tallies']

type Seen = 'unsupported' | 'unstarted' | 'failed-start' | 'passed'

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((item, n) => item === b[n])

/** Two reports that say the same; a banner drawn from the first need not be drawn (or read out) again. */
export function sameReport(a: CompatReport, b: CompatReport): boolean {
  return a.moai === b.moai && a.toolMissing === b.toolMissing && a.catalog.state === b.catalog.state &&
    sameList(a.catalog.missing, b.catalog.missing) && sameList(a.degraded, b.degraded)
}

/**
 * The compatibility banner already tells this refusal (install moai, update the catalog), so the board's own
 * banners need not tell it again. An `unsupported-daemon` the catalog line does not stand for (the daemon as a
 * whole too old, or nothing decided yet) is still the board's to tell.
 */
export function compatTells(report: CompatReport | null, outcome: Outcome | null): boolean {
  if (!report || outcome?.kind !== 'refused') return false
  if (outcome.code === 'tool-missing') return report.toolMissing
  return outcome.code === 'unsupported-daemon' && report.catalog.state === 'missing'
}

export class CompatProbe {
  private readonly seen = new Map<string, Seen>()
  private toolMissing = false
  /** undefined: not seen yet. */
  private statusShape: { statuses: boolean; tallies: boolean } | undefined
  private rowsSeen = 0
  private unreadSeen = false

  /** Hand over what a request to `profile` ended with. Information refusals and failures say nothing here. */
  observe(profile: string, outcome: Outcome): void {
    switch (outcome.kind) {
      case 'refused':
        if (outcome.code === 'tool-missing') this.toolMissing = true
        else if (outcome.code === 'unsupported-daemon') this.seen.set(profile, 'unsupported')
        return
      case 'not-started':
        // Only `unsupported-daemon` is about the catalog; `binding-mismatch` and the rest are a start that failed.
        if (outcome.code === 'unsupported-daemon') {
          if (this.seen.get(profile) !== 'passed' && this.seen.get(profile) !== 'unsupported') this.seen.set(profile, 'unstarted')
        } else if (!this.seen.has(profile)) {
          this.seen.set(profile, 'failed-start')
        }
        return
      case 'passed':
      case 'failed':
      case 'moai-error':
      case 'not-initialized':
      case 'unreadable':
        // It ran, so the catalog has the profile (a repository without `.moai/` is a board matter, not this), and moai
        // is there: once it is installed after a `tool-missing` refusal, the banner stops asking for it.
        this.seen.set(profile, 'passed')
        this.toolMissing = false
        return
      case 'cancelled':
        return
    }
  }

  /** The rows of `show --all` (or `prime`), archive-tagged ones left out. */
  observeRows(rows: readonly Row[]): void {
    for (const row of rows) {
      if (row.archived === true) continue
      this.rowsSeen += 1
      if ('unread' in row) this.unreadSeen = true
    }
  }

  /** The `status --json` output; anything that is not the counts object (the project list) is not read. */
  observeStatus(output: unknown): void {
    if (typeof output !== 'object' || output === null || Array.isArray(output)) return
    const record = output as Record<string, unknown>
    if (typeof record.counts !== 'object' || record.counts === null) return
    this.statusShape = {
      statuses: Array.isArray(record.statuses) && record.statuses.length > 0,
      tallies: Array.isArray(record.milestones) || Array.isArray(record.epics),
    }
  }

  report(): CompatReport {
    const refused = [...this.seen].filter(([, seen]) => seen === 'unsupported' || seen === 'unstarted').map(([id]) => id)
    const passed = [...this.seen.values()].filter((seen) => seen === 'passed').length
    // A shipped profile refused as unsupported, or nothing passed while a shipped one was refused: the daemon as
    // a whole is too old (or bound wrong), and 13 missing profiles would say less than that.
    const wholeDaemon = refused.some((id) => BASELINE.has(id) && (this.seen.get(id) === 'unsupported' || passed === 0))
    const missing = wholeDaemon ? [] : refused
    const catalogState: CompatReport['catalog']['state'] = wholeDaemon ? 'unknown' : missing.length > 0 ? 'missing' : passed > 0 ? 'ok' : 'unknown'

    const old = this.statusShape !== undefined && (!this.statusShape.statuses || !this.statusShape.tallies)
    let moai: CompatReport['moai'] = 'unknown'
    if (old) moai = 'old'
    else if (this.statusShape !== undefined) moai = 'ok'

    const degraded = new Set<Feature>()
    for (const id of refused) {
      const feature = FEATURE_OF[id]
      if (feature !== undefined) degraded.add(feature)
    }
    if (this.statusShape !== undefined && !this.statusShape.statuses) degraded.add('status-order')
    if (this.statusShape !== undefined && !this.statusShape.tallies) degraded.add('tallies')
    // NEW needs the `unread` key; an old moai that prints none leaves the marks off (a 0.16 that prints it keeps them).
    if (moai === 'old' && this.rowsSeen > 0 && !this.unreadSeen) degraded.add('unread')

    return {
      moai,
      toolMissing: this.toolMissing,
      catalog: { state: catalogState, missing },
      degraded: ORDER.filter((feature) => degraded.has(feature)),
    }
  }
}
