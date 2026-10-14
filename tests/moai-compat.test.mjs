import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { panelModule } from './moai-panel-modules.mjs'

const fixture = async (name) => JSON.parse(await readFile(new URL(`./fixtures/moai/${name}`, import.meta.url), 'utf8'))
const { CompatProbe, sameReport } = await panelModule('data/compat.ts')
const { PROFILE, loadAllRows, loadStatuses, loadArchived, loadWikiListing } = await panelModule('data/source.ts')
const { markRead } = await panelModule('data/read.ts')

const passed = (output) => ({ kind: 'passed', output })
const refused = (code) => ({ kind: 'refused', code })
const withoutUnread = (rows) => rows.map(({ unread: _unread, ...row }) => row)

/** A client answering each profile from `answers` (an outcome, or a function of the value). */
const clientOf = (answers) => ({
  async request(profile, value) {
    const answer = answers[profile]
    return typeof answer === 'function' ? answer(value) : (answer ?? { kind: 'not-started' })
  },
  cancel() {},
})

const everything = async (overrides = {}) => ({
  [PROFILE.showAll]: passed(await fixture('show-all-v016.json')),
  [PROFILE.backlog]: passed(await fixture('backlog-v016.json')),
  [PROFILE.status]: passed(await fixture('status-statuses-assumed.json')),
  ...overrides,
})

test('nothing seen yet says nothing is known', () => {
  assert.deepEqual(new CompatProbe().report(), { moai: 'unknown', toolMissing: false, catalog: { state: 'unknown', missing: [] }, degraded: [] })
})

test('the assumed shapes (statuses[], tallies, unread) read as a whole new setup', async () => {
  const probe = new CompatProbe()
  const client = clientOf(await everything())
  assert.equal((await loadAllRows(client, undefined, probe)).ok, true)
  assert.equal((await loadStatuses(client, undefined, probe)).ok, true)
  assert.deepEqual(probe.report(), { moai: 'ok', toolMissing: false, catalog: { state: 'ok', missing: [] }, degraded: [] })
})

test('real 0.16 output: no statuses[] is an old moai, the order falls back and NEW still works', async () => {
  const probe = new CompatProbe()
  const client = clientOf(await everything({ [PROFILE.status]: passed(await fixture('status-v016.json')) }))
  await loadAllRows(client, undefined, probe)
  const statuses = await loadStatuses(client, undefined, probe)
  assert.deepEqual(statuses.value, ['todo', 'in_progress', 'review', 'done'])
  const report = probe.report()
  assert.equal(report.moai, 'old')
  assert.deepEqual(report.degraded, ['status-order'])
  assert.equal(report.catalog.state, 'ok')
})

test('rows without `unread` on an old moai also turn the marks off', async () => {
  const probe = new CompatProbe()
  const client = clientOf(await everything({
    [PROFILE.showAll]: passed(withoutUnread(await fixture('show-all-unread-v016.json'))),
    [PROFILE.backlog]: passed(withoutUnread(await fixture('backlog-v016.json'))),
    [PROFILE.status]: passed(await fixture('status-v016.json')),
  }))
  await loadAllRows(client, undefined, probe)
  await loadStatuses(client, undefined, probe)
  assert.deepEqual(probe.report().degraded, ['unread', 'status-order'])
})

test('rows without `unread` alone are not proof: moai stays unknown', async () => {
  const probe = new CompatProbe()
  await loadAllRows(clientOf(await everything({
    [PROFILE.showAll]: passed(withoutUnread(await fixture('show-all-v016.json'))),
    [PROFILE.backlog]: passed(withoutUnread(await fixture('backlog-v016.json'))),
  })), undefined, probe)
  assert.deepEqual(probe.report(), { moai: 'unknown', toolMissing: false, catalog: { state: 'ok', missing: [] }, degraded: [] })
})

test('a status with no milestones[] and epics[] degrades the tallies', () => {
  const probe = new CompatProbe()
  probe.observeStatus({ counts: { todo: 1 }, total: 1, statuses: ['todo'] })
  assert.deepEqual(probe.report().degraded, ['tallies'])
  assert.equal(probe.report().moai, 'old')
})

test('the project list (outside a board) is not read as a shape', () => {
  const probe = new CompatProbe()
  probe.observeStatus({ projects: [{ path: '/w' }] })
  assert.equal(probe.report().moai, 'unknown')
})

// show --all failing calls off the backlog read beside it (source.ts); what that read already ended with is still observed.
test('unsupported-daemon on added profiles names them; their features degrade, the rest keeps working', async () => {
  const probe = new CompatProbe()
  const client = clientOf(await everything({
    [PROFILE.showAll]: refused('unsupported-daemon'),
    [PROFILE.backlog]: refused('unsupported-daemon'),
    [PROFILE.wikiLs]: passed({ pages: [] }),
    [PROFILE.showArchived]: refused('unsupported-daemon'),
  }))
  assert.equal((await loadAllRows(client, undefined, probe)).ok, false)
  await loadStatuses(client, undefined, probe)
  await loadWikiListing(client, probe)
  await loadArchived(client, { probe })
  const report = probe.report()
  assert.equal(report.catalog.state, 'missing')
  assert.deepEqual(report.catalog.missing.sort(), [PROFILE.showAll, PROFILE.backlog, PROFILE.showArchived].sort())
  assert.deepEqual(report.degraded, ['all-rows', 'backlog', 'archive'])
})

test('a shipped profile refused as unsupported means the daemon as a whole, not 13 missing profiles', async () => {
  const probe = new CompatProbe()
  const client = clientOf({ [PROFILE.status]: refused('unsupported-daemon'), [PROFILE.showAll]: refused('unsupported-daemon') })
  await loadStatuses(client, undefined, probe)
  const report = probe.report()
  assert.deepEqual(report.catalog, { state: 'unknown', missing: [] })
  assert.equal(report.moai, 'unknown')
})

test('tool-missing is its own flag and does not blame the catalog', async () => {
  const probe = new CompatProbe()
  await loadStatuses(clientOf({ [PROFILE.status]: refused('tool-missing') }), undefined, probe)
  assert.deepEqual(probe.report(), { moai: 'unknown', toolMissing: true, catalog: { state: 'unknown', missing: [] }, degraded: [] })
})

test('a profile that only ever fails to start (binding-mismatch is thrown, its code carried) is read as missing; a pass clears it', async () => {
  const probe = new CompatProbe()
  const reads = [{ kind: 'not-started', code: 'binding-mismatch' }, passed({ read: ['a'], missing: [], held: [], problems: [], at: 'now' })]
  const client = clientOf({ [PROFILE.status]: passed({ counts: { todo: 0 }, statuses: ['todo'], milestones: [], epics: [] }), [PROFILE.read]: () => reads.shift() })
  await loadStatuses(client, undefined, probe)
  await markRead(client, { id: 'a' }, probe)
  assert.deepEqual(probe.report().catalog, { state: 'missing', missing: [PROFILE.read] })
  assert.deepEqual(probe.report().degraded, ['read-marks'])
  await markRead(client, { id: 'a' }, probe)
  assert.deepEqual(probe.report().catalog, { state: 'ok', missing: [] })
})

test('a start that failed without naming a catalog code leaves the catalog unknown, not missing', async () => {
  const probe = new CompatProbe()
  const client = clientOf({ [PROFILE.status]: passed({ counts: { todo: 0 }, statuses: ['todo'], milestones: [], epics: [] }), [PROFILE.read]: { kind: 'not-started' } })
  await loadStatuses(client, undefined, probe)
  await markRead(client, { id: 'a' }, probe)
  assert.deepEqual(probe.report().catalog, { state: 'ok', missing: [] })
  assert.deepEqual(probe.report().degraded, [])
  probe.observe(PROFILE.readAll, { kind: 'not-started', code: 'something-new' })
  assert.deepEqual(probe.report().catalog, { state: 'ok', missing: [] })
})

test('information refusals and cancellations are not compatibility evidence', () => {
  const probe = new CompatProbe()
  probe.observe(PROFILE.showAll, refused('declined'))
  probe.observe(PROFILE.showAll, refused('workspace-busy'))
  probe.observe(PROFILE.showAll, { kind: 'cancelled', mayContinue: false })
  assert.equal(probe.report().catalog.state, 'unknown')
})

test('two reports that say the same are the same, so the banner is not drawn again', () => {
  const report = () => ({ moai: 'old', toolMissing: false, catalog: { state: 'missing', missing: [PROFILE.showAll] }, degraded: ['all-rows', 'status-order'] })
  assert.equal(sameReport(report(), report()), true)
  for (const change of [{ moai: 'ok' }, { toolMissing: true }, { catalog: { state: 'missing', missing: [PROFILE.backlog] } }, { degraded: ['all-rows'] }]) {
    assert.equal(sameReport(report(), { ...report(), ...change }), false, JSON.stringify(change))
  }
})

test('tool-missing goes once a run starts there again (moai installed while the panel is open)', () => {
  const probe = new CompatProbe()
  probe.observe(PROFILE.status, refused('tool-missing'))
  assert.equal(probe.report().toolMissing, true)
  probe.observe(PROFILE.status, refused('declined'))
  assert.equal(probe.report().toolMissing, true, 'a refusal that says nothing of the tool keeps it')
  probe.observe(PROFILE.status, passed({ counts: { todo: 0 }, statuses: ['todo'], milestones: [], epics: [] }))
  assert.equal(probe.report().toolMissing, false)
})
