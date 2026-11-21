import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { JobStore, promptHash } from '../lib/jobs.mjs'

async function withStore(run) {
  const root = await mkdtemp(join(tmpdir(), 'sd-jobs-'))
  try {
    await run(new JobStore(root))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

const take = { momentId: 'm1', prompt: 'a woman runs to the bus', seconds: 5, width: 576, height: 1024, fps: 24, seed: 7 }

test('a job is recorded before submission and moves through the happy path', () => withStore(async (store) => {
  const job = await store.create(take, 'fake')
  assert.equal(job.state, 'planned')
  await store.transition(job.id, 'submitting')
  await store.transition(job.id, 'submitted', { remoteId: 'v1_abc' })
  await store.transition(job.id, 'generating')
  await store.transition(job.id, 'ready')
  const done = await store.transition(job.id, 'downloaded', { file: 'takes/m1.mp4', sha256: 'x' })
  assert.equal(done.state, 'downloaded')
  assert.equal(done.remoteId, 'v1_abc')
  assert.equal((await store.get(job.id)).history.length, 6)
}))

test('illegal transitions are refused so a take is never silently resubmitted', () => withStore(async (store) => {
  const job = await store.create(take, 'fake')
  await store.transition(job.id, 'submitting')
  await store.transition(job.id, 'submitted', { remoteId: 'v1_abc' })
  await assert.rejects(store.transition(job.id, 'submitting'), /submitted → submitting/)
}))

test('a timeout leaves the job unknown, recoverable only by checking the remote id', () => withStore(async (store) => {
  const job = await store.create(take, 'fake')
  await store.transition(job.id, 'submitting')
  await store.transition(job.id, 'submitted', { remoteId: 'v1_abc' })
  const lost = await store.transition(job.id, 'unknown', { reason: 'timeout' })
  assert.equal(lost.state, 'unknown')
  await store.transition(job.id, 'generating')
}))

test('the same prompt that already downloaded is reused instead of generated again', () => withStore(async (store) => {
  const first = await store.create(take, 'fake')
  for (const state of ['submitting', 'submitted', 'generating', 'ready']) await store.transition(first.id, state, { remoteId: 'r' })
  await store.transition(first.id, 'downloaded', { file: 'takes/m1.mp4', sha256: 'x' })
  const reusable = await store.findReusable(take)
  assert.equal(reusable?.id, first.id)
  assert.equal(await store.findReusable({ ...take, prompt: 'different' }), undefined)
}))

test('an in-flight job for the same prompt blocks a duplicate submission', () => withStore(async (store) => {
  const first = await store.create(take, 'fake')
  await store.transition(first.id, 'submitting')
  await assert.rejects(store.create(take, 'fake'), /already in flight/)
}))

test('prompt hash covers everything that changes the generated video', () => {
  assert.equal(promptHash(take), promptHash({ ...take }))
  assert.notEqual(promptHash(take), promptHash({ ...take, seconds: 4 }))
  assert.notEqual(promptHash(take), promptHash({ ...take, seed: 8 }))
  assert.equal(promptHash(take), promptHash({ ...take, momentId: 'm9' }), 'the same take in another moment is reusable')
})
