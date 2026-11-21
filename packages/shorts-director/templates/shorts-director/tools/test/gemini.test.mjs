import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildImageRequest,
  buildTtsRequest,
  buildVideoRequest,
  createGeminiClient,
  extractImage,
  extractMedia,
} from '../lib/gemini.mjs'

test('video request follows the Omni REST shape and runs in the background', () => {
  const body = buildVideoRequest({
    prompt: 'She runs out of the subway exit into heavy rain.',
    seconds: 8,
    aspect: '9:16',
    resolution: '720p',
    firstFrame: { data: 'AAAA', mimeType: 'image/png' },
  })
  assert.equal(body.model, 'gemini-omni-1.2-flash')
  assert.equal(body.background, true)
  assert.equal(body.store, true)
  assert.deepEqual(body.response_format, { type: 'video', aspect_ratio: '9:16', duration: '8s', resolution: '720p', delivery: 'inline' })
  assert.equal(body.input[0].type, 'image')
  assert.equal(body.input.at(-1).type, 'text')
  assert.match(body.input.at(-1).text, /first frame/i)
  assert.doesNotMatch(body.input.at(-1).text, /<IMAGE_REF|<FIRST_FRAME>/)
})

test('large resolutions are delivered by uri', () => {
  const body = buildVideoRequest({ prompt: 'p', seconds: 8, aspect: '9:16', resolution: '1080p' })
  assert.equal(body.response_format.delivery, 'uri')
})

test('reference images are capped at six and described in plain language', () => {
  const refs = Array.from({ length: 6 }, () => ({ data: 'A', mimeType: 'image/png', role: 'the woman' }))
  const body = buildVideoRequest({ prompt: 'p', seconds: 8, aspect: '9:16', refs })
  assert.match(body.input.at(-1).text, /Image 6 shows the woman/)
  assert.throws(() => buildVideoRequest({ prompt: 'p', seconds: 8, aspect: '9:16', refs: [...refs, refs[0]] }), /at most 6/)
})

test('seconds outside 3 to 15 are refused before spending quota', () => {
  assert.throws(() => buildVideoRequest({ prompt: 'p', seconds: 2, aspect: '9:16' }), /3 to 15/)
  assert.throws(() => buildVideoRequest({ prompt: 'p', seconds: 16, aspect: '9:16' }), /3 to 15/)
})

test('media is read from the last model_output step of the REST response', () => {
  const response = {
    id: 'v1_x',
    status: 'completed',
    steps: [
      { type: 'user_input', content: [{ type: 'text', text: 'p' }] },
      { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'Zmlyc3Q=' }] },
      { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', uri: 'https://x/files/a:download?alt=media' }] },
    ],
  }
  assert.deepEqual(extractMedia(response, 'video'), { uri: 'https://x/files/a:download?alt=media', mimeType: 'video/mp4' })
  assert.equal(extractMedia({ steps: [] }, 'video'), undefined)
})

test('TTS request uses the Interactions API with a speech style annotation', () => {
  const body = buildTtsRequest({ text: '우산 없이 나와 본 적 있죠?', voice: 'Kore', style: 'warm, a little teasing' })
  assert.equal(body.model, 'gemini-3.8-flash-tts')
  assert.deepEqual(body.response_format, { type: 'audio', mime_type: 'audio/wav' })
  assert.deepEqual(body.generation_config.speech_config, [{ voice: 'Kore' }])
  assert.equal(body.input[0].content[0].annotations[0].style, 'warm, a little teasing')
})

test('image request uses generateContent with a 9:16 image config', () => {
  const body = buildImageRequest({ prompt: 'character sheet', aspect: '9:16', refs: [{ data: 'A', mimeType: 'image/png' }] })
  assert.deepEqual(body.generationConfig.responseModalities, ['TEXT', 'IMAGE'])
  assert.equal(body.generationConfig.imageConfig.aspectRatio, '9:16')
  assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/png')
  assert.equal(body.contents[0].parts.at(-1).text, 'character sheet')
  assert.deepEqual(
    extractImage({ candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'QQ==' } }] } }] }),
    { mimeType: 'image/png', data: 'QQ==' },
  )
})

test('the client sends the key as a header, never in the URL, and polls interactions by id', async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return new Response(JSON.stringify({ id: 'v1_x', status: 'in_progress' }), { status: 200 })
  }
  const client = createGeminiClient({ apiKey: 'secret', fetchImpl })
  await client.createInteraction({ model: 'm' })
  await client.getInteraction('v1_x')
  assert.equal(calls[0].url, 'https://generativelanguage.googleapis.com/v1beta/interactions')
  assert.equal(calls[0].init.headers['x-goog-api-key'], 'secret')
  assert.equal(calls[1].url, 'https://generativelanguage.googleapis.com/v1beta/interactions/v1_x')
  for (const call of calls) assert.doesNotMatch(call.url, /secret/)
})

test('API errors surface status and message without the key', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 })
  const client = createGeminiClient({ apiKey: 'secret', fetchImpl })
  await assert.rejects(client.createInteraction({}), (error) => {
    assert.equal(error.status, 429)
    assert.match(error.message, /quota exceeded/)
    assert.doesNotMatch(error.message, /secret/)
    return true
  })
})
