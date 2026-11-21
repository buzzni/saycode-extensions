import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { buildLtxRequest, framesFor, ltxVideoBackend } from '../lib/backends/ltx.mjs'
import { qwenSpeech } from '../lib/backends/qwen-tts.mjs'

const video = { width: 576, height: 1024, fps: 24 }

test('LTX frame counts sit on the 8n+1 grid and stay within 9..121', () => {
  assert.equal(framesFor(5, 24), 121)
  assert.equal(framesFor(1, 24), 25)
  assert.equal(framesFor(2.5, 24), 57)
  assert.equal(framesFor(0.1, 24), 9)
  assert.equal(framesFor(9, 24), 121)
})

test('LTX request carries the take prompt, size, frame count and seed', () => {
  const body = buildLtxRequest({ prompt: 'rain', seconds: 5, seed: 7 }, video)
  assert.deepEqual(body, { prompt: 'rain', width: 576, height: 1024, num_frames: 121, fps: 24, seed: 7 })
  assert.throws(() => buildLtxRequest({ prompt: 'x'.repeat(4001), seconds: 3, seed: 1 }, video), /4000/)
})

test('a first frame is sent as an image condition on frame "first"', () => {
  const body = buildLtxRequest({ prompt: 'p', seconds: 5, seed: 1 }, video, { firstFrame: 'QUJD' })
  assert.deepEqual(body.images, [{ frame: 'first', data: 'QUJD' }])
  assert.equal(buildLtxRequest({ prompt: 'p', seconds: 5, seed: 1 }, video).images, undefined)
})

function fakeServer(routes) {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    const route = routes.find((item) => url.endsWith(item.path) && (item.method ?? 'GET') === (init.method ?? 'GET'))
    if (!route) return new Response('not found', { status: 404 })
    const { status = 200, json, bytes, type } = typeof route.reply === 'function' ? route.reply() : route.reply
    if (bytes) return new Response(bytes, { status, headers: { 'content-type': type ?? 'application/octet-stream' } })
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetchImpl }
}

test('LTX backend submits a job, maps queued/running to generating, then downloads the video', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-ltx-'))
  try {
    let status = 'queued'
    const server = fakeServer([
      { path: '/jobs', method: 'POST', reply: { status: 202, json: { id: 'job-1', status: 'queued' } } },
      { path: '/jobs/job-1', reply: () => ({ json: { id: 'job-1', status } }) },
      { path: '/jobs/job-1/video', reply: { bytes: Buffer.from('MP4DATA'), type: 'video/mp4' } },
    ])
    const backend = ltxVideoBackend({ baseUrl: 'http://ltx.local:8010/', video, fetchImpl: server.fetchImpl })
    const submitted = await backend.submit({ prompt: 'rain', seconds: 5, seed: 3 })
    assert.equal(submitted.remoteId, 'job-1')
    assert.equal(JSON.parse(server.calls[0].body).num_frames, 121)

    const saveTo = join(root, 'take.mp4')
    assert.deepEqual(await backend.poll({ remoteId: 'job-1' }, { saveTo }), { status: 'generating' })
    status = 'running'
    assert.deepEqual(await backend.poll({ remoteId: 'job-1' }, { saveTo }), { status: 'generating' })
    status = 'succeeded'
    assert.deepEqual(await backend.poll({ remoteId: 'job-1' }, { saveTo }), { status: 'completed' })
    assert.equal(await readFile(saveTo, 'utf8'), 'MP4DATA')
    assert.equal(server.calls[0].url, 'http://ltx.local:8010/jobs')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('LTX failures and a full queue are reported, not retried silently', async () => {
  const failed = fakeServer([{ path: '/jobs/job-2', reply: { json: { id: 'job-2', status: 'failed', error: 'CUDA out of memory' } } }])
  const backend = ltxVideoBackend({ baseUrl: 'http://ltx.local', video, fetchImpl: failed.fetchImpl })
  assert.deepEqual(await backend.poll({ remoteId: 'job-2' }, { saveTo: '/dev/null' }), { status: 'failed', reason: 'CUDA out of memory' })

  const full = fakeServer([{ path: '/jobs', method: 'POST', reply: { status: 429, json: { detail: 'Queue full' } } }])
  const busy = ltxVideoBackend({ baseUrl: 'http://ltx.local', video, fetchImpl: full.fetchImpl })
  await assert.rejects(busy.submit({ prompt: 'p', seconds: 2, seed: 1 }), (error) => error.status === 429 && /Queue full/.test(error.message))
})

test('Qwen TTS sends a bearer token, the language and speaker, and writes the wav', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-tts-'))
  try {
    const server = fakeServer([{ path: '/v1/tts/speech', method: 'POST', reply: { bytes: Buffer.from('RIFFWAVE'), type: 'audio/wav' } }])
    const speak = qwenSpeech({ baseUrl: 'http://tts.local:8765', token: 'secret-token', fetchImpl: server.fetchImpl })
    const out = join(root, 'line.wav')
    await speak(out, { text: '안녕하세요', language: 'korean', speaker: 'sohee' })
    assert.equal(await readFile(out, 'utf8'), 'RIFFWAVE')
    const call = server.calls[0]
    assert.equal(call.url, 'http://tts.local:8765/v1/tts/speech')
    assert.equal(call.headers.Authorization, 'Bearer secret-token')
    assert.deepEqual(JSON.parse(call.body), { text: '안녕하세요', language: 'korean', speaker: 'sohee' })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('Qwen TTS refuses lines over 500 characters and reports server errors without the token', async () => {
  const server = fakeServer([{ path: '/v1/tts/speech', method: 'POST', reply: { status: 401, json: { detail: 'A valid Bearer token is required.' } } }])
  const speak = qwenSpeech({ baseUrl: 'http://tts.local', token: 'secret-token', fetchImpl: server.fetchImpl })
  await assert.rejects(speak('/dev/null', { text: '가'.repeat(501), language: 'korean' }), /500/)
  await assert.rejects(speak('/dev/null', { text: '안녕', language: 'korean' }), (error) => {
    assert.equal(error.status, 401)
    assert.match(error.message, /Bearer token is required/)
    assert.doesNotMatch(error.message, /secret-token/)
    return true
  })
  assert.throws(() => qwenSpeech({ baseUrl: 'http://tts.local', token: '' }), /QWEN_TTS_TOKEN/)
})
