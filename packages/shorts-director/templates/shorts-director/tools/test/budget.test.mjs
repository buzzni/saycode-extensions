import assert from 'node:assert/strict'
import { test } from 'node:test'

import { estimateApiUsd, routeBackend } from '../lib/budget.mjs'

const api = { enabled: true, capUsd: 3, costPerSecond: { '360p': 0.023, '720p': 0.07, '1080p': 0.104 }, resolution: '720p' }

test('the whole video goes to the app when its remaining quota covers every take', () => {
  const route = routeBackend({ takes: [8, 8, 8], app: { enabled: true, measured: true, remaining: 3 }, api })
  assert.equal(route.backend, 'gemini-app')
  assert.equal(route.needsApproval, false)
})

test('backends are not mixed inside one video: short app quota sends everything to the API with approval', () => {
  const route = routeBackend({ takes: [8, 8, 8], app: { enabled: true, measured: true, remaining: 2 }, api })
  assert.equal(route.backend, 'gemini-omni-api')
  assert.equal(route.needsApproval, true)
  assert.equal(route.estimatedUsd, estimateApiUsd([8, 8, 8], api))
  assert.match(route.reason, /2/)
})

test('an unmeasured app backend is never chosen', () => {
  const route = routeBackend({ takes: [8], app: { enabled: true, measured: false, remaining: 3 }, api })
  assert.equal(route.backend, 'gemini-omni-api')
})

test('autopilot may switch to the API without asking only inside the pre-approved cap', () => {
  const inside = routeBackend({ takes: [8, 8, 8], app: { enabled: false }, api, autopilot: true })
  assert.equal(inside.needsApproval, false)
  const over = routeBackend({ takes: [8, 8, 8], app: { enabled: false }, api: { ...api, capUsd: 1 }, autopilot: true })
  assert.equal(over.backend, 'wait')
  assert.match(over.reason, /상한/)
})

test('with neither backend available the route says wait', () => {
  const route = routeBackend({ takes: [8], app: { enabled: true, measured: true, remaining: 0 }, api: { ...api, enabled: false } })
  assert.equal(route.backend, 'wait')
})

test('the fake backend short-circuits for tests and dry runs', () => {
  const route = routeBackend({ takes: [8], app: { enabled: false }, api, fake: true })
  assert.equal(route.backend, 'fake')
  assert.equal(route.needsApproval, false)
})

test('API cost counts output seconds at the chosen resolution plus a per-call overhead', () => {
  const usd = estimateApiUsd([8, 8], api)
  assert.ok(usd > 16 * 0.07)
  assert.ok(usd < 16 * 0.07 + 0.2)
})
