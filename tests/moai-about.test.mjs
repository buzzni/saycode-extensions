// Moai panel header (se-qkga): the TUI's logo, then `User` and `Version` from `status --json`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { JSDOM } from 'jsdom'

import { panelModule } from './moai-panel-modules.mjs'

const A = await panelModule('data/about.ts')
const B = await panelModule('view/brand.ts')
const { copyFor } = await panelModule('i18n/index.ts')
const { initialState, reduce } = await panelModule('store.ts')

const en = copyFor('en').shell.version
const ko = copyFor('ko').shell.version

test('aboutFrom reads the user line and the version with what moai last heard of the latest; an older moai gives nulls', () => {
  const status = { counts: {}, user: { name: 'Raven', email: 'raven@buzzni.com', label: 'Raven <raven@buzzni.com>' }, version: { current: '0.18.0', latest: { state: 'stale', tag: 'v0.18.0', heard_at: '2026-10-12T00:00:00Z', why: 'offline' } } }
  assert.deepEqual(A.aboutFrom(status), { user: 'Raven <raven@buzzni.com>', version: '0.18.0', latest: { state: 'stale', tag: 'v0.18.0', heardAt: '2026-10-12T00:00:00Z', why: 'offline' } })
  assert.deepEqual(A.aboutFrom({ counts: {} }), { user: null, version: null, latest: null })
  assert.deepEqual(A.aboutFrom({ user: null, version: { current: '0.18.0', latest: null } }), { user: null, version: '0.18.0', latest: null })
  assert.deepEqual(A.aboutFrom({ version: { current: '0.18.0', latest: { state: 'weird' } } }).latest, null)
  assert.deepEqual(A.aboutFrom([]), { user: null, version: null, latest: null })
})

test('versionLine writes what the TUI writes, in moai\'s own words', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  const about = (latest) => ({ user: null, version: '0.18.0', latest })
  assert.deepEqual(A.versionLine(about({ state: 'same', tag: 'v0.18.0' }), en, now), { said: '0.18.0 · latest (v0.18.0)' })
  assert.deepEqual(A.versionLine(about({ state: 'same', tag: 'v0.18.0' }), ko, now), { said: '0.18.0 · 최신 (v0.18.0)' })
  assert.deepEqual(A.versionLine(about({ state: 'newer', tag: 'v0.19.0' }), en, now), { said: '0.18.0 · v0.19.0 is out' })
  assert.deepEqual(A.versionLine(about({ state: 'ahead', tag: 'v0.17.0' }), ko, now), { said: '0.18.0 · 릴리스보다 앞선 판 (v0.17.0)' })
  assert.deepEqual(A.versionLine(about({ state: 'unasked', why: 'offline' }), en, now), { said: '0.18.0 · latest not checked (no network)' })
  assert.deepEqual(A.versionLine(about({ state: 'unasked', why: 'something-new' }), en, now), { said: '0.18.0 · latest not checked' })
  // A cached answer it could not refresh: when it was heard goes after it, as the TUI's tail.
  assert.deepEqual(A.versionLine(about({ state: 'stale', tag: 'v0.18.0', heardAt: '2026-10-12T09:00:00Z', why: 'timeout' }), ko, now), { said: '0.18.0 · 최신 확인 안 함 (타임아웃)', tail: '3일 전에 본 판 v0.18.0' })
  assert.equal(A.versionLine(about({ state: 'stale', tag: 'v0.18.0', heardAt: '2026-10-15T01:00:00Z' }), en, now).tail, 'v0.18.0 seen today')
  assert.equal(A.versionLine(about({ state: 'stale', tag: 'v0.18.0', heardAt: '2099-01-01T00:00:00Z' }), en, now).tail, 'v0.18.0 seen earlier', 'a time ahead is not today')
  assert.deepEqual(A.versionLine(about(null), en, now), { said: '0.18.0' })
  assert.deepEqual(A.versionLine({ user: null, version: null, latest: null }, en, now), { said: '—' })
  assert.deepEqual(A.versionLine(null, en, now), { said: '—' })
  // Japanese and Chinese read moai's English, as the TUI does.
  assert.equal(copyFor('ja').shell.version, en)
})

test('the logo is the TUI\'s, the art centred as one block over the tagline; the info lines keep the TUI\'s columns', () => {
  const lines = B.logoLines()
  assert.equal(lines.length, 6)
  assert.equal(lines[5], 'Issue tracker for AI agent')
  assert.ok(lines.every((line) => [...line].length === 26), 'one width, so the pipe stands straight')
  assert.equal(lines[2], ' ▐█ ▌▐▌▐█·▐█▌.▐▌▄█▀▀█ ▐█· ', 'the widest art row moves in by the same one cell as the others')
  assert.deepEqual(B.infoLines(null, en), [['User', '—'], ['Version', '—']])
  const about = { user: 'Raven <raven@buzzni.com>', version: '0.18.0', latest: { state: 'stale', tag: 'v0.18.0', heardAt: '2026-10-14T00:00:00Z' } }
  assert.deepEqual(B.infoLines(about, en, Date.parse('2026-10-15T12:00:00Z')), [['User', 'Raven <raven@buzzni.com>'], ['Version', '0.18.0 · latest not checked'], ['', 'v0.18.0 seen 1 day ago']])
  const doc = new JSDOM('<!doctype html><body></body>').window.document
  const brand = B.mountBrand(doc, en)
  brand.render(about)
  assert.deepEqual([...brand.el.querySelectorAll('.m-brand-line')].map((line) => line.textContent), [
    'User    : Raven <raven@buzzni.com>',
    'Version : 0.18.0 · latest not checked',
    `          ${B.infoLines(about, en)[2][1]}`,
  ])
  assert.equal(brand.el.querySelector('.m-brand-logo').getAttribute('aria-hidden'), 'true')
})

test('store: a status read that says what the last said changes nothing', () => {
  const about = { user: 'Raven', version: '0.18.0', latest: null }
  const once = reduce(initialState(), { type: 'about', about })
  assert.deepEqual(once.about, about)
  assert.equal(reduce(once, { type: 'about', about: { ...about } }), once)
  assert.notEqual(reduce(once, { type: 'about', about: { ...about, user: null } }), once)
})
