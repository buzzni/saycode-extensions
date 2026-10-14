import assert from 'node:assert/strict'
import { after, test } from 'node:test'

import { panelModule } from './moai-panel-modules.mjs'

const { PRIORITY, createClient, outcomeOf, refusalOf, requestKey } = await panelModule('data/client.ts')
const { rowsFromPrime } = await panelModule('data/source.ts')

// Runs a test leaves running would poll forever; once every test is over they all end cancelled.
let closing = false
after(() => { closing = true })

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve)) }

/**
 * A fake panel bridge. Each start gets an operation `op-N`; a run stays running until the test finishes it
 * with `finish(N, status)`.
 */
function fakeBridge() {
  const calls = []
  const done = new Map()
  let next = 0
  return {
    calls,
    finish(n, status) { done.set(`op-${n}`, status) },
    async invokeCommand(command, args) {
      calls.push([command, args])
      if (command === 'buzzni.moai.run') return { action: 'start', state: 'accepted', operationId: `op-${++next}` }
      if (command === 'buzzni.moai.cancel') {
        done.set(args[0], { state: 'cancelled', remoteMayContinue: true })
        return { action: 'cancel', state: 'cancelled' }
      }
      if (closing) return { action: 'status', operationId: args[0], state: 'cancelled' }
      return { action: 'status', operationId: args[0], ...(done.get(args[0]) ?? { state: 'running' }) }
    },
  }
}

const passed = (output) => ({ state: 'passed', stdout: JSON.stringify(output), stderr: '', exitCode: 0 })
const starts = (bridge) => bridge.calls.filter(([command]) => command === 'buzzni.moai.run').map(([, args]) => args)

test('a run is started, polled until it ends, and its JSON is the outcome', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush() })
  const outcome = client.request('buzzni.moai.status')
  await flush()
  assert.deepEqual(client.requests().map((request) => [request.phase, request.operationId]), [['running', 'op-1']])
  bridge.finish(1, passed({ counts: { todo: 1 } }))
  assert.deepEqual(await outcome, { kind: 'passed', output: { counts: { todo: 1 } } })
  assert.deepEqual(client.requests(), [])
  assert.deepEqual(starts(bridge), [['buzzni.moai.status']])
})

test('the same read asked twice while it runs is shared, not started again', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush() })
  const first = client.request('buzzni.moai.show', 'a-1')
  const second = client.request('buzzni.moai.show', 'a-1')
  assert.equal(first, second)
  await flush()
  bridge.finish(1, passed({ id: 'a-1' }))
  await first
  assert.deepEqual(starts(bridge), [['buzzni.moai.show', 'a-1']])
})

test('writes are never shared', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush(), concurrency: 2 })
  const first = client.request('buzzni.moai.add', 'Same', { share: false })
  const second = client.request('buzzni.moai.add', 'Same', { share: false })
  assert.notEqual(first, second)
  await flush()
  assert.equal(starts(bridge).length, 2)
})

test('with one run at a time, the detail goes before a waiting list refresh', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush() })
  client.request('buzzni.moai.status', undefined, { priority: PRIORITY.background })
  await flush()
  client.request('buzzni.moai.prime', undefined, { priority: PRIORITY.list })
  client.request('buzzni.moai.show', 'a-1', { priority: PRIORITY.detail })
  await flush()
  assert.deepEqual(client.requests().map((request) => [request.profileId, request.phase]),
    [['buzzni.moai.status', 'running'], ['buzzni.moai.prime', 'queued'], ['buzzni.moai.show', 'queued']])
  bridge.finish(1, passed({}))
  await flush()
  assert.deepEqual(starts(bridge).map(([profile]) => profile), ['buzzni.moai.status', 'buzzni.moai.show'])
})

test('a slow run does not lock the others when more may run at once', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush(), concurrency: 2 })
  const slow = client.request('buzzni.moai.prime')
  const quick = client.request('buzzni.moai.show', 'a-1')
  await flush()
  bridge.finish(2, passed({ id: 'a-1' }))
  assert.equal((await quick).kind, 'passed')
  assert.equal(client.requests()[0].profileId, 'buzzni.moai.prime')
  bridge.finish(1, passed({}))
  await slow
})

test('a queued request is cancelled at once; a running one asks the machine and ends cancelled', async () => {
  const bridge = fakeBridge()
  const client = createClient(bridge, { sleep: () => flush() })
  const running = client.request('buzzni.moai.prime')
  const queued = client.request('buzzni.moai.show', 'a-1')
  await flush()
  client.cancel(requestKey('buzzni.moai.show', 'a-1'))
  assert.deepEqual(await queued, { kind: 'cancelled', mayContinue: false })
  client.cancel(requestKey('buzzni.moai.prime'))
  assert.deepEqual(await running, { kind: 'cancelled', mayContinue: true })
  assert.deepEqual(bridge.calls.filter(([command]) => command === 'buzzni.moai.cancel'), [['buzzni.moai.cancel', ['op-1']]])
})

test('a start that throws or is refused is an outcome, and the next request still runs', async () => {
  let call = 0
  const client = createClient({
    async invokeCommand(command) {
      call += 1
      if (call === 1) throw new Error('capability.invoke machine.run/start failed: binding-mismatch')
      if (call === 2) return { action: 'start', state: 'refused', code: 'workspace-busy' }
      if (call === 3) return { action: 'start', state: 'refused', code: 'something-new' }
      return command === 'buzzni.moai.run' ? { state: 'accepted', operationId: 'op' } : passed({})
    },
  }, { sleep: () => flush() })
  assert.deepEqual(await client.request('buzzni.moai.prime'), { kind: 'not-started' })
  assert.deepEqual(await client.request('buzzni.moai.prime'), { kind: 'refused', code: 'workspace-busy' })
  assert.deepEqual(await client.request('buzzni.moai.prime'), { kind: 'not-started' })
  assert.equal((await client.request('buzzni.moai.prime')).kind, 'passed')
})

test('finished runs read as Moai errors, a missing board, unreadable output or plain failure', () => {
  assert.deepEqual(outcomeOf({ state: 'failed', stdout: '', stderr: JSON.stringify({ error: 'unknown id: x' }) }), { kind: 'moai-error', message: 'unknown id: x' })
  assert.deepEqual(outcomeOf({ state: 'failed', stderr: JSON.stringify({ error: 'Not a moai repository (no .moai/ above /w)' }) }), { kind: 'not-initialized' })
  assert.deepEqual(outcomeOf({ state: 'passed', stdout: 'not json' }), { kind: 'unreadable' })
  assert.deepEqual(outcomeOf({ state: 'failed', stdout: '', stderr: 'boom' }), { kind: 'failed' })
  assert.deepEqual(outcomeOf({ state: 'cancelled' }), { kind: 'cancelled', mayContinue: false })
  assert.deepEqual(outcomeOf(null), { kind: 'failed' })
  assert.equal(refusalOf({ state: 'accepted', operationId: 'op' }), null)
  assert.deepEqual(refusalOf({ state: 'accepted' }), { kind: 'not-started' })
})

test('prime rows become index rows; a folder without a board says so', () => {
  const loaded = rowsFromPrime({ picked: [{ id: 'a', status: 'in_progress' }], others: [{ id: 'b' }, { id: 'a' }], ready: [{ id: 'c' }, { bad: true }], rest: 2, others_rest: 1 })
  assert.equal(loaded.ok, true)
  assert.deepEqual(loaded.value.rows.map((row) => [row.id, row.kind]), [['a', 'issue'], ['b', 'issue'], ['c', 'issue']])
  assert.equal(loaded.value.more, 3)
  assert.deepEqual(rowsFromPrime({ no_tracker: true }), { ok: false, outcome: { kind: 'not-initialized' } })
})
