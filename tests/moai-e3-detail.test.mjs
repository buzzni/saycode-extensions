// Moai panel detail view (se-c10x.mh9): the pure wording of the head, fields, blockers, roll-up and journal,
// and the pane itself in a jsdom document.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

import { panelModule } from './moai-panel-modules.mjs'

const F = await panelModule('view/detail-format.ts')
const { mountDetail, renderBody } = await panelModule('view/detail.ts')
const { IssueIndex } = await panelModule('data/index.ts')
const { initialState, reduce } = await panelModule('store.ts')
const { copyFor } = await panelModule('i18n/index.ts')

const en = copyFor('en')
const ko = copyFor('ko')

const ROWS = [
  { id: 'se-m1', kind: 'milestone', title: 'v2.0', status: 'todo' },
  { id: 'se-e1', kind: 'epic', title: 'E3 views', milestone: 'se-m1', status: 'todo' },
  { id: 'se-e1.a', kind: 'issue', title: 'List', epic: 'se-e1', derived_epic: 'se-e1', status: 'done', priority: 1 },
  { id: 'se-e1.b', kind: 'issue', title: 'Board', epic: 'se-e1', derived_epic: 'se-e1', status: 'in_progress', blocked_by: ['se-e1.a', 'se-e1.c', 'se-gone'] },
  { id: 'se-e1.c', kind: 'issue', title: 'Detail', epic: 'se-e1', derived_epic: 'se-e1', status: 'todo', deferred_at: '2026-10-01T00:00:00Z' },
]
const index = new IssueIndex(ROWS)

test('head: status label and tone, priority, kind and deferral', () => {
  const head = F.headOf({ id: 'x', title: 'T', status: 'in_progress', priority: 1, kind: 'epic' }, ko)
  assert.deepEqual([head.statusLabel, head.tone, head.priority, head.kind], ['진행 중', 'accent', 'P1', '에픽'])
  assert.equal(F.headOf({ id: 'x', status: 'done', kind: 'issue' }, en).kind, '')
  assert.equal(F.headOf({ id: 'x' }, en).title, 'x')
  assert.equal(F.headOf({ id: 'x', status: 'todo', deferred_at: '2026-10-01T00:00:00Z', deferred_reason: 'later' }, en).deferred, 'later')
  // A closed row is not deferred whatever it says.
  assert.equal(F.headOf({ id: 'x', status: 'done', deferred_at: '2026-10-01T00:00:00Z' }, en).deferred, '')
})

test('fields: only those with a value, epic and milestone with their titles', () => {
  const row = { id: 'se-e1.b', assignee: 'dev', assignee_email: 'dev@example.com', epic: 'se-e1', derived_epic: 'se-e1', milestone: 'se-m1', created_at: 'not a date' }
  const fields = F.fieldsOf(row, index, en)
  assert.deepEqual(fields.map((f) => f.key), ['assignee', 'epic', 'milestone'])
  assert.equal(fields[0].value, 'dev <dev@example.com>')
  assert.equal(fields[1].value, 'E3 views (se-e1)')
  assert.equal(F.formatDate('2026-10-12'), '2026-10-12')
  assert.match(F.formatDate('2026-10-12T13:17:11Z'), /^2026-10-1[23] \d\d:\d\d$/)
  assert.equal(F.formatDate(undefined), '')
})

test('blockers: done, open, deferred and unknown; blocks come from the rows that name it', () => {
  assert.equal(F.blockerState('se-e1.a', index), 'done')
  assert.equal(F.blockerState('se-e1.b', index), 'open')
  assert.equal(F.blockerState('se-e1.c', index), 'deferred')
  assert.equal(F.blockerState('se-gone', index), 'missing')
  assert.equal(F.blockerState('se-e1.a', null), 'missing')
  assert.deepEqual(F.blocksOf({ id: 'se-e1.a' }, index), ['se-e1.b'])
  assert.deepEqual(F.blocksOf({ id: 'se-e1.a', blocks: ['z'] }, index), ['z', 'se-e1.b'])
})

test('roll-up: n/n of the work under a group, none for work', () => {
  const rollup = F.rollupOf(ROWS[1], index)
  assert.equal(rollup.done, 1)
  assert.equal(rollup.work, 3)
  assert.equal(rollup.percent, 33)
  assert.deepEqual(rollup.byStatus, [['done', 1], ['in_progress', 1], ['todo', 1]])
  assert.equal(F.rollupOf(ROWS[2], index), null)
  assert.equal(F.rollupOf(ROWS[1], null), null)
  assert.equal(en.detail.rollupText(1, 3, 33), '1/3 done · 33%')
  assert.equal(en.detail.rollupText(0, 0, undefined), '0/0 done')
})

test('journal, commits and work lines', () => {
  const row = {
    id: 'a',
    journal: [
      { kind: 'create', by: 'dev', ts: '2026-10-10T15:11:44Z' },
      { kind: 'status', from: 'todo', to: 'in_progress', by: 'dev' },
      { kind: 'note', text: 'hello' },
      7,
    ],
    commits: ['0123456789', { sha: 'abcdef012345', subject: 'fix it\nmore' }, {}],
    work: [{ summary: 'ran', by: 'ai' }, 'plain'],
  }
  const lines = F.journalOf(row, en)
  assert.deepEqual(lines.map((l) => l.text), ['Created', 'To do → In progress', 'hello'])
  assert.match(lines[0].meta, /^dev · 2026-/)
  assert.deepEqual(F.commitsOf(row), [{ hash: '0123456', subject: '' }, { hash: 'abcdef0', subject: 'fix it' }])
  assert.deepEqual(F.workOf(row), ['ran  ai', 'plain'])
})

test('problem text uses the shell words', () => {
  assert.equal(F.problemText({ kind: 'refused', code: 'declined' }, en), en.refused.declined)
  assert.equal(F.problemText({ kind: 'moai-error', message: 'boom' }, en), en.moaiError('boom'))
  assert.equal(F.problemText({ kind: 'passed', output: 1 }, en), null)
})

// ── the pane ──────────────────────────────────────────────────────────────────────────────────────────

function mount(overrides = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="r"></div></body>')
  const doc = dom.window.document
  const calls = []
  const ctx = {
    document: doc, copy: en, language: 'en',
    intents: { closeDetail: () => calls.push('close') },
    layout: () => ({ width: 800, mainWidth: 800, position: 'bottom', detailVisible: true }),
    focusPane() {},
    ...overrides,
  }
  const root = doc.getElementById('r')
  const view = mountDetail(root, ctx)
  return { doc, root, view, calls }
}
const stateWith = (shown) => ({ ...initialState(), shown: { value: null, loading: false, problem: null, ...shown } })

test('pane: nothing chosen, loading and a problem', () => {
  const { root, view } = mount()
  view.render(stateWith({}), index)
  assert.match(root.textContent, /Choose a task/)
  view.render(stateWith({ loading: true }), index)
  assert.match(root.textContent, /Loading/)
  view.render(stateWith({ problem: { kind: 'refused', code: 'declined' } }), index)
  assert.ok(root.querySelector('.m-banner-danger'))
  assert.match(root.textContent, /confirmation was declined/)
})

test('pane: a group shows head, fields, roll-up, body as text, and close reports the intent', () => {
  const { doc, root, view, calls } = mount()
  const row = { ...ROWS[1], body: '<img src=x onerror=alert(1)>\nline two', tags: ['ui'], priority: 1, commits: [{ hash: 'abcdef0123', subject: 'first' }], journal: [{ kind: 'create', by: 'dev' }] }
  view.render(stateWith({ value: { id: 'se-e1', row } }), index)
  assert.equal(root.querySelector('.moai-detail-title').textContent, 'E3 views')
  assert.match(root.textContent, /1\/3 done · 33%/)
  assert.match(root.textContent, /v2\.0 \(se-m1\)/)
  assert.match(root.textContent, /abcdef0/)
  assert.match(root.textContent, /Created/)
  const body = root.querySelector('.moai-detail-body')
  assert.equal(body.children.length, 0)
  assert.equal(body.textContent, row.body)
  assert.ok(root.querySelector('[role=progressbar]'))
  root.querySelector('button').click()
  assert.deepEqual(calls, ['close'])
  assert.equal(renderBody(doc, 'a<b').textContent, 'a<b')
})

test('pane: a task lists its blockers with marks; a redraw keeps the opened history', () => {
  const { root, view } = mount()
  const row = ROWS[3]
  view.render(stateWith({ value: { id: row.id, row } }), index)
  const marks = [...root.querySelectorAll('.moai-detail-mark')].map((m) => m.textContent)
  assert.deepEqual(marks, ['✓', '⏸', '?'])
  assert.equal(root.querySelector('[role=progressbar]'), null)
  const fold = root.querySelector('details[data-fold=journal]')
  fold.open = true
  fold.dispatchEvent(new root.ownerDocument.defaultView.Event('toggle'))
  view.render(stateWith({ value: { id: row.id, row } }), index)
  assert.equal(root.querySelector('details[data-fold=journal]').open, true)
})
