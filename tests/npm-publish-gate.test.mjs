import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decidePublish } from '../scripts/lib/npmPublishGate.mjs'

const query = { name: '@buzzni/saycode-extension-sdk', version: '0.1.0' }

// Measured contract of `npm view <pkg>@<version> version --json` on npm 10 (the npm Node 22 ships, pinned in CI):
// both "package never published" and "package exists, version absent" exit 1 with a structured E404 on stdout.
// The prose on stderr is not part of the contract — npm has reworded it across majors and it vanishes under
// --silent — so the gate must never publish on any signal other than that structured E404.

test('publishes when the registry has never seen the package', () => {
  const decision = decidePublish({
    ...query,
    exitCode: 1,
    stdout: JSON.stringify({ error: { code: 'E404', summary: 'Not Found', detail: 'is not in this registry' } }),
    stderr: 'npm error code E404',
  })

  assert.equal(decision.publish, true)
  assert.match(decision.reason, /not published/i)
})

test('publishes when the package exists but this exact version does not', () => {
  // The ordinary path for every release after the first.
  const decision = decidePublish({
    ...query,
    exitCode: 1,
    stdout: JSON.stringify({ error: { code: 'E404', summary: 'No match found for version 0.1.0', detail: '' } }),
    stderr: '',
  })

  assert.equal(decision.publish, true)
})

test('fails closed on a structured registry error that is not a missing package', () => {
  assert.throws(
    () => decidePublish({ ...query, exitCode: 1, stdout: JSON.stringify({ error: { code: 'EPERM' } }), stderr: '' }),
    /EPERM/,
  )
})

test('fails closed when npm fails without a structured error, even if stderr mentions a 404', () => {
  // Publishing on stderr prose would mean publishing on a signal npm does not guarantee.
  assert.throws(
    () => decidePublish({ ...query, exitCode: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }),
    /unexpectedly/,
  )
})

test('skips when this exact version is already published', () => {
  const decision = decidePublish({ ...query, exitCode: 0, stdout: '["0.0.1","0.1.0"]\n', stderr: '' })

  assert.equal(decision.publish, false)
  assert.match(decision.reason, /already published/i)
})

test('skips when the registry returns a single version as a bare string', () => {
  // `npm view <pkg>@<exact> version --json` collapses a single match to a string rather than an array.
  const decision = decidePublish({ ...query, exitCode: 0, stdout: '"0.1.0"\n', stderr: '' })

  assert.equal(decision.publish, false)
})

test('fails closed when npm succeeds but returns no output', () => {
  // Older npm majors reported "version absent" this way; current npm never does. Absence of output is not
  // a confirmed "not published" signal, so it must not publish.
  assert.throws(() => decidePublish({ ...query, exitCode: 0, stdout: '\n', stderr: '' }), /shape|empty|unexpected/i)
})

test('fails closed when the registry response cannot be parsed', () => {
  assert.throws(() => decidePublish({ ...query, exitCode: 0, stdout: 'not json', stderr: '' }), /parse/i)
})

test('fails closed on a registry response shape it does not understand', () => {
  // An object or a nested value would otherwise miss `includes(version)` and publish over an existing release.
  assert.throws(() => decidePublish({ ...query, exitCode: 0, stdout: '{"0.1.0":"0.1.0"}', stderr: '' }), /shape|unexpected/i)
  assert.throws(() => decidePublish({ ...query, exitCode: 0, stdout: '[["0.1.0"]]', stderr: '' }), /shape|unexpected/i)
  assert.throws(() => decidePublish({ ...query, exitCode: 0, stdout: 'null', stderr: '' }), /shape|unexpected/i)
})

test('rejects a query without an exact version', () => {
  assert.throws(() => decidePublish({ name: query.name, version: '', exitCode: 0, stdout: '[]', stderr: '' }), /version/i)
})
