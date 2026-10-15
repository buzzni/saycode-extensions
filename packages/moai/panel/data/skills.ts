/**
 * Whether this repository has moai's skills for its agents, the optional `moai-saycode` among them, and planting it
 * (se-gowr.fk2). The supervisor (`moai-supervise`, always planted) hands work to Saycode sessions only with
 * `moai-saycode`, which `moai skill install` plants only when asked (`--with`). No DOM here.
 *
 * What `moai skill status --json` tells:
 * - `written`: the plugin tree (`.claude/moai-plugin`) is in this checkout. False: no moai skills at all.
 * - `installs[]`: Claude Code has this checkout's moai registered. The daemon's moai cannot register it: `claude` is not
 *   on the PATH the daemon gives a run, so an install there plants the files and reports `registered: false`.
 * - `optional[]`: the optional skills planted. A moai before it (0.17.0 and older) does not print it, and then whether
 *   `moai-saycode` is there cannot be told: only a missing tree is.
 *
 * Installing from the panel needs a moai that prints `optional`. An older one, run by the daemon, rewrote the hooks'
 * `moai` to the managed binary's absolute path (its PATH lookup needs `sh`, which the daemon's PATH lacks), and the
 * hooks would go quiet when that pinned version moves. With such a moai the panel only shows the command to run.
 *
 * Neither read is handed to the compatibility probe: a catalog without these profiles keeps every other feature,
 * and this one is simply not offered (no banner asks to update the catalog for it).
 */
import { PRIORITY, answerOf, type Client } from './client.js'
import { PROFILE, type Loaded } from './source.js'

export const SAYCODE_SKILL = 'moai-saycode'
/** What a person runs in the project folder to do by hand what the button does, registration included. */
export const INSTALL_COMMAND = `moai skill install --with ${SAYCODE_SKILL}`

export interface SkillReport {
  /** The plugin tree is in this checkout. */
  written: boolean
  /** Claude Code has this checkout's moai registered. */
  registered: boolean
  /** The optional skills planted; undefined when this moai does not say (older than the `optional` field). */
  optional?: string[]
}

/** What the repository lacks: `moai` (no skills at all), `saycode` (the optional skill), or nothing that can be told. */
export type SkillNeed = 'moai' | 'saycode' | null

export interface Installed {
  /** The optional skills planted after the run. */
  planted: string[]
  /** Claude Code registered it in this run (never, from the daemon: see the header). */
  registered: boolean
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const names = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [])

/** `optional` as a list of names, or as install's `{planted}` object; undefined when the key is not there. */
function optionalOf(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return names(value)
  if (isRecord(value) && Array.isArray(value.planted)) return names(value.planted)
  return undefined
}

/** `skill status --json`; null for anything that is not its object. */
export function skillReport(output: unknown): SkillReport | null {
  if (!isRecord(output) || typeof output.written !== 'boolean') return null
  const optional = optionalOf(output.optional)
  return {
    written: output.written,
    registered: Array.isArray(output.installs) && output.installs.length > 0,
    ...(optional === undefined ? {} : { optional }),
  }
}

export function skillNeed(report: SkillReport | null): SkillNeed {
  if (!report) return null
  if (!report.written) return 'moai'
  if (report.optional !== undefined && !report.optional.includes(SAYCODE_SKILL)) return 'saycode'
  return null
}

/** The panel may plant it itself: only a moai that says what is planted keeps the hooks' `moai` (see the header). */
export const canInstall = (report: SkillReport | null): boolean => report?.optional !== undefined

/** `skill install --json` after `--with moai-saycode`; null for anything that is not its object. */
export function installed(output: unknown): Installed | null {
  if (!isRecord(output)) return null
  return { planted: optionalOf(output.optional) ?? [], registered: output.registered === true }
}

export async function loadSkills(client: Client): Promise<Loaded<SkillReport>> {
  const outcome = await client.request(PROFILE.skillStatus, undefined, { priority: PRIORITY.background })
  const output = answerOf(outcome)
  if (output === undefined) return { ok: false, outcome }
  const report = skillReport(output)
  return report ? { ok: true, value: report } : { ok: false, outcome: { kind: 'unreadable' } }
}

/** The write: Desktop asks for it every time. */
export async function installSaycode(client: Client): Promise<Loaded<Installed>> {
  const outcome = await client.request(PROFILE.skillInstall, undefined, { priority: PRIORITY.detail, share: false })
  // A write that ended non-zero did not do what it said, whatever JSON it printed on the way.
  if (outcome.kind !== 'passed') return { ok: false, outcome }
  const done = installed(outcome.output)
  return done ? { ok: true, value: done } : { ok: false, outcome: { kind: 'unreadable' } }
}
