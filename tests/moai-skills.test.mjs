// Moai panel: whether the repository has moai's skills, `moai-saycode` among them, and planting it (se-gowr.fk2).
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { panelModule } from './moai-panel-modules.mjs'

const S = await panelModule('data/skills.ts')
const { PROFILE } = await panelModule('data/source.ts')
const { initialState, reduce } = await panelModule('store.ts')

test('skillReport reads `skill status --json`: the tree, the registration, and the optional skills when moai says', () => {
  assert.deepEqual(S.skillReport({ written: true, installs: [{ scope: 'local' }], optional: ['moai-saycode'] }), { written: true, registered: true, optional: ['moai-saycode'] })
  // moai 0.17.0 prints no `optional`: what is planted cannot be told, only whether the tree is there.
  assert.deepEqual(S.skillReport({ written: false, installs: [] }), { written: false, registered: false })
  // install's `{planted}` shape is read the same.
  assert.deepEqual(S.skillReport({ written: true, installs: [], optional: { planted: ['moai-tmux'], held: [], removed: [] } }).optional, ['moai-tmux'])
  for (const junk of [null, [], 'text', { installs: [] }, { written: 'yes' }]) assert.equal(S.skillReport(junk), null)
})

test('skillNeed: no tree is moai missing; a known list without moai-saycode is that one missing; anything else offers nothing', () => {
  assert.equal(S.skillNeed(null), null)
  assert.equal(S.skillNeed({ written: false, registered: false }), 'moai')
  assert.equal(S.skillNeed({ written: true, registered: true, optional: [] }), 'saycode')
  assert.equal(S.skillNeed({ written: true, registered: true, optional: ['moai-saycode'] }), null)
  // A moai that does not say what is planted: the skill may be there, so nothing is offered.
  assert.equal(S.skillNeed({ written: true, registered: true }), null)
})

test('canInstall: only a moai that says what is planted plants it from the panel (an older one rewrote the hooks to its own path)', () => {
  assert.equal(S.canInstall({ written: false, registered: false, optional: [] }), true)
  assert.equal(S.canInstall({ written: false, registered: false }), false)
  assert.equal(S.canInstall(null), false)
  assert.equal(S.INSTALL_COMMAND, 'moai skill install --with moai-saycode')
})

const fakeClient = (answers) => {
  const asked = []
  return {
    asked,
    request: async (profileId, value, options) => {
      asked.push([profileId, value, options])
      return answers[profileId]
    },
  }
}

test('loadSkills reads the status profile in the background; installSaycode is an unshared write that must pass', async () => {
  const client = fakeClient({
    [PROFILE.skillStatus]: { kind: 'passed', output: { written: true, installs: [], optional: [] } },
    [PROFILE.skillInstall]: { kind: 'passed', output: { registered: false, optional: { planted: ['moai-saycode'], held: [], removed: [] } } },
  })
  assert.deepEqual(await S.loadSkills(client), { ok: true, value: { written: true, registered: false, optional: [] } })
  assert.deepEqual(await S.installSaycode(client), { ok: true, value: { planted: ['moai-saycode'], registered: false } })
  assert.equal(client.asked[0][2].priority, 3)
  assert.equal(client.asked[1][2].share, false)
  // A write that ended non-zero did not do what it printed.
  const failing = fakeClient({ [PROFILE.skillInstall]: { kind: 'failed', output: { registered: false, optional: { planted: ['moai-saycode'] } } } })
  assert.deepEqual(await S.installSaycode(failing), { ok: false, outcome: { kind: 'failed', output: { registered: false, optional: { planted: ['moai-saycode'] } } } })
  const refused = fakeClient({ [PROFILE.skillStatus]: { kind: 'refused', code: 'unsupported-daemon' } })
  assert.deepEqual(await S.loadSkills(refused), { ok: false, outcome: { kind: 'refused', code: 'unsupported-daemon' } })
  const odd = fakeClient({ [PROFILE.skillStatus]: { kind: 'passed', output: [] } })
  assert.deepEqual(await S.loadSkills(odd), { ok: false, outcome: { kind: 'unreadable' } })
})

test('store: the skills report, an install from start to end or failure, and "later"', () => {
  let state = initialState()
  assert.deepEqual(state.skills, { report: null, installing: false, installed: null, problem: null, dismissed: false })
  const report = { written: true, registered: false, optional: [] }
  state = reduce(state, { type: 'skills', report })
  assert.equal(state.skills.report, report)
  state = reduce(state, { type: 'skills-installing' })
  assert.equal(state.skills.installing, true)
  const problem = { kind: 'refused', code: 'declined' }
  state = reduce(state, { type: 'skills-failed', problem })
  assert.deepEqual([state.skills.installing, state.skills.problem], [false, problem])
  state = reduce(reduce(state, { type: 'skills-installing' }), { type: 'skills-installed', installed: { planted: ['moai-saycode'], registered: false }, report: { ...report, optional: ['moai-saycode'] } })
  assert.deepEqual(state.skills.report.optional, ['moai-saycode'])
  assert.equal(state.skills.problem, null, 'the try that passed takes the earlier failure away')
  // Without a status read after it, the report stays the one before.
  const kept = reduce(state, { type: 'skills-installed', installed: { planted: [], registered: true } })
  assert.equal(kept.skills.report, state.skills.report)
  assert.equal(reduce(state, { type: 'skills-dismissed' }).skills.dismissed, true)
})
