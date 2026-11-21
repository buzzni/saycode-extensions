// LTX-2.5 로컬 영상 서버. 글(+ 고정할 프레임 이미지)을 받아 한 번에 최대 121프레임(24fps 약 5초)을 만들고,
// 장면 소리도 함께 넣는다. 제출(POST /jobs) → 조회(GET /jobs/{id}) → 받기(GET /jobs/{id}/video).
import { writeFile } from 'node:fs/promises'

export const LTX_TAKE_SECONDS = { min: 1, max: 5 }
const MIN_FRAMES = 9
const MAX_FRAMES = 121
const MAX_PROMPT_CHARS = 4000

export function framesFor(seconds, fps) {
  const frames = 8 * Math.round((Number(seconds) * fps - 1) / 8) + 1
  return Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, frames))
}

export function buildLtxRequest(take, video, { firstFrame } = {}) {
  if (take.prompt.length > MAX_PROMPT_CHARS) throw new Error(`LTX prompt is ${take.prompt.length} characters — the server accepts at most ${MAX_PROMPT_CHARS}`)
  return {
    prompt: take.prompt,
    width: video.width,
    height: video.height,
    num_frames: framesFor(take.seconds, video.fps),
    fps: video.fps,
    seed: take.seed,
    ...(firstFrame ? { images: [{ frame: 'first', data: firstFrame }] } : {}),
  }
}

export class ServerError extends Error {
  constructor(service, status, message) {
    super(`${service} ${status}: ${message}`)
    this.status = status
  }
}

export function ltxVideoBackend({ baseUrl, video, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('LTX_URL is not set — run: shorts-director init --ltx-url <url> --tts-url <url> (saved once for this PC)')
  const base = baseUrl.replace(/\/+$/, '')

  async function call(path, init = {}) {
    const response = await fetchImpl(`${base}${path}`, { ...init, signal: AbortSignal.timeout(120_000) })
    if (!response.ok) throw new ServerError('LTX', response.status, await errorText(response))
    return response
  }

  return {
    name: 'ltx',
    async submit(take, { firstFrame } = {}) {
      const response = await call('/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildLtxRequest(take, video, { firstFrame })),
      })
      const job = await response.json()
      return { remoteId: job.id }
    },
    async poll(job, { saveTo }) {
      const state = await (await call(`/jobs/${encodeURIComponent(job.remoteId)}`)).json()
      if (state.status === 'queued' || state.status === 'running') return { status: 'generating' }
      if (state.status === 'failed') return { status: 'failed', reason: state.error ?? 'LTX job failed' }
      const response = await call(`/jobs/${encodeURIComponent(job.remoteId)}/video`)
      await writeFile(saveTo, Buffer.from(await response.arrayBuffer()))
      return { status: 'completed' }
    },
  }
}

export async function errorText(response) {
  const text = await response.text()
  try {
    const json = JSON.parse(text)
    return typeof json.detail === 'string' ? json.detail : JSON.stringify(json.detail ?? json)
  } catch {
    return text.slice(0, 300) || response.statusText
  }
}
