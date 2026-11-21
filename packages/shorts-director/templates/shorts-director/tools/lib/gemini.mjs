// Gemini API (viskit 과 같은 경로): 영상은 Interactions API 의 gemini-omni-1.2-flash, 음성은 Gemini TTS,
// 이미지는 generateContent 의 Nano Banana. 키는 헤더로만 보낸다 — URL 에 실으면 로그에 남는다.

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'
export const VIDEO_MODEL = 'gemini-omni-1.2-flash'
export const TTS_MODEL = 'gemini-3.8-flash-tts'
export const IMAGE_MODEL = 'gemini-nano-banana-2.1'
const MAX_IMAGES = 6
const MAX_FIRST_LAST_SECONDS = 10
const URI_RESOLUTIONS = new Set(['1080p', '4k'])

export function buildVideoRequest({ prompt, seconds, aspect, resolution = '720p', firstFrame, lastFrame, refs = [], task, model = VIDEO_MODEL }) {
  if (!Number.isInteger(seconds) || seconds < 3 || seconds > 15) throw new Error('video seconds must be a whole number from 3 to 15')
  if (lastFrame && seconds > MAX_FIRST_LAST_SECONDS) throw new Error(`first and last frame videos support at most ${MAX_FIRST_LAST_SECONDS}s`)
  const images = []
  const roles = []
  if (firstFrame) {
    images.push(firstFrame)
    roles.push(`Image ${images.length} is the first frame of the video; start exactly from it.`)
  }
  if (lastFrame) {
    images.push(lastFrame)
    roles.push(`Image ${images.length} is the last frame of the video; end exactly on it.`)
  }
  for (const ref of refs) {
    images.push(ref)
    roles.push(`Image ${images.length} shows ${ref.role ?? 'a reference for the look of the subject'}; keep that look.`)
  }
  if (images.length > MAX_IMAGES) throw new Error(`Omni accepts at most ${MAX_IMAGES} images per call`)

  const text = roles.length ? `${roles.join(' ')}\n\n${prompt}` : prompt
  return {
    model,
    background: true,
    store: true,
    input: [
      ...images.map((image) => ({ type: 'image', data: image.data, mime_type: image.mimeType })),
      { type: 'text', text },
    ],
    response_format: {
      type: 'video',
      aspect_ratio: aspect,
      duration: `${seconds}s`,
      resolution,
      delivery: URI_RESOLUTIONS.has(resolution) ? 'uri' : 'inline',
    },
    ...(task ? { generation_config: { video_config: { task } } } : {}),
  }
}

export function buildTtsRequest({ text, voice = 'Kore', style, model = TTS_MODEL }) {
  return {
    model,
    input: [{
      type: 'user_input',
      content: [{
        type: 'text',
        text,
        ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}),
      }],
    }],
    response_format: { type: 'audio', mime_type: 'audio/wav' },
    generation_config: { speech_config: [{ voice }] },
  }
}

export function buildImageRequest({ prompt, aspect = '9:16', refs = [], imageSize }) {
  return {
    contents: [{
      role: 'user',
      parts: [
        ...refs.map((ref) => ({ inlineData: { mimeType: ref.mimeType, data: ref.data } })),
        { text: prompt },
      ],
    }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      imageConfig: { aspectRatio: aspect, ...(imageSize ? { imageSize } : {}) },
    },
  }
}

// REST 응답에서는 SDK 의 output_video/output_audio 편의 필드가 없다 — steps 의 마지막 model_output 에서 꺼낸다.
export function extractMedia(response, type) {
  for (const step of [...(response.steps ?? [])].reverse()) {
    if (step.type !== 'model_output') continue
    for (const part of [...(step.content ?? [])].reverse()) {
      if (part.type !== type) continue
      if (part.data) return { data: part.data, mimeType: part.mime_type }
      if (part.uri) return { uri: part.uri, mimeType: part.mime_type }
    }
  }
  return undefined
}

export function extractImage(response) {
  for (const candidate of response.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if (part.inlineData?.data) return { mimeType: part.inlineData.mimeType, data: part.inlineData.data }
    }
  }
  return undefined
}

export class GeminiError extends Error {
  constructor(status, message, body) {
    super(`Gemini API ${status}: ${message}`)
    this.status = status
    this.body = body
  }
}

export function createGeminiClient({ apiKey, fetchImpl = fetch, baseUrl = BASE_URL }) {
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set — put it in .env (never commit it)')
  const headers = { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey }

  async function call(method, url, body, timeoutMs = 120_000) {
    const response = await fetchImpl(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let json
    try {
      json = text ? JSON.parse(text) : {}
    } catch {
      json = { raw: text.slice(0, 500) }
    }
    if (!response.ok) throw new GeminiError(response.status, json.error?.message ?? response.statusText, json)
    return json
  }

  return {
    createInteraction: (body) => call('POST', `${baseUrl}/interactions`, body),
    getInteraction: (id) => call('GET', `${baseUrl}/interactions/${encodeURIComponent(id)}`),
    generateContent: (model, body) => call('POST', `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`, body, 300_000),
    async download(uri) {
      // Files API 다운로드 주소는 키가 있어야 받힌다(맨몸 GET 은 403).
      const response = await fetchImpl(uri, { headers: { 'x-goog-api-key': apiKey }, signal: AbortSignal.timeout(300_000) })
      if (!response.ok) throw new GeminiError(response.status, `download failed (${response.statusText})`)
      return Buffer.from(await response.arrayBuffer())
    },
  }
}
