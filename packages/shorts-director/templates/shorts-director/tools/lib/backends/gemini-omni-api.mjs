// 공식 API 백엔드(viskit 과 같은 경로): Interactions API 의 gemini-omni-1.2-flash 를 background 로 제출하고
// id 로 조회한다. 제출 응답에서 id 를 받은 순간이 과금 시작점이라, 그 id 를 곧바로 job 에 남긴다.
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { buildImageRequest, buildTtsRequest, buildVideoRequest, extractImage, extractMedia, GeminiError, IMAGE_MODEL } from '../gemini.mjs'

export function geminiVideoBackend(client) {
  return {
    name: 'gemini-omni-api',
    async submit(take, { root }) {
      const body = buildVideoRequest({
        prompt: take.prompt,
        seconds: take.seconds,
        aspect: take.aspect,
        resolution: take.resolution,
        firstFrame: take.firstFrame ? await imagePart(join(root, take.firstFrame)) : undefined,
      })
      const response = await client.createInteraction(body)
      if (!response.id) throw new Error('Interactions API returned no id')
      return { remoteId: response.id, status: response.status }
    },
    async poll(job, { saveTo }) {
      const response = await client.getInteraction(job.remoteId)
      if (response.status === 'in_progress' || response.status === 'requires_continuation') return { status: 'generating' }
      if (response.status !== 'completed') {
        return { status: 'failed', reason: `interaction ${response.status}${response.error?.message ? `: ${response.error.message}` : ''}` }
      }
      const media = extractMedia(response, 'video')
      if (!media) return { status: 'blocked', reason: '완료됐지만 영상이 없다 — 안전 정책 차단일 가능성이 높다' }
      await writeFile(saveTo, media.data ? Buffer.from(media.data, 'base64') : await client.download(media.uri))
      return { status: 'completed' }
    },
  }
}

export async function geminiSpeech(client, out, { text, voice, style }) {
  const response = await client.createInteraction(buildTtsRequest({ text, voice, style }))
  const audio = extractMedia(response, 'audio')
  if (!audio?.data) throw new Error('TTS 응답에 음성이 없다')
  await writeFile(out, Buffer.from(audio.data, 'base64'))
}

export async function geminiImage(client, out, { prompt, aspect, refs = [], model = IMAGE_MODEL }) {
  const parts = await Promise.all(refs.map((file) => imagePart(file)))
  const response = await client.generateContent(model, buildImageRequest({ prompt, aspect, refs: parts }))
  const image = extractImage(response)
  if (!image) throw new Error('이미지 응답에 그림이 없다 — 안전 정책 차단이면 인물 묘사를 줄여 다시 그린다')
  await writeFile(out, Buffer.from(image.data, 'base64'))
}

export function isQuotaError(error) {
  return error instanceof GeminiError && error.status === 429
}

async function imagePart(file) {
  const mimeType = file.endsWith('.jpg') || file.endsWith('.jpeg') ? 'image/jpeg' : 'image/png'
  return { data: (await readFile(file)).toString('base64'), mimeType }
}
