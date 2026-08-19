import assert from 'node:assert/strict'
import { test } from 'node:test'

import { decidePublish } from '../scripts/lib/npmPublishGate.mjs'

const query = { name: '@buzzni/saycode-extension-sdk', version: '0.1.0' }

test('publishes when the registry has never seen the package', () => {
  const decision = decidePublish({
    ...query,
    exitCode: 1,
    stdout: '',
    stderr: 'npm error code E404\nnpm error 404 Not Found - GET https://registry.npmjs.org/@buzzni%2fsaycode-extension-sdk',
  })

  assert.equal(decision.publish, true)
  assert.match(decision.reason, /not published/i)
})

test('publishes when the package exists but this version does not', () => {
  const decision = decidePublish({ ...query, exitCode: 0, stdout: '["0.0.1","0.0.2"]\n', stderr: '' })

  assert.equal(decision.publish, true)
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

test('fails closed on an unrecognised registry failure rather than publishing', () => {
  assert.throws(
    () => decidePublish({ ...query, exitCode: 1, stdout: '', stderr: 'npm error code E500\nnpm error 500 Internal' }),
    /E500|unexpected/i,
  )
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
