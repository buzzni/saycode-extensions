// Qwen3-TTS 서버. Bearer 토큰으로 POST /v1/tts/speech 에 한 줄씩 보내 wav 를 받는다.
// 이 모델은 말투 지시(instruct)를 받지 않는다 — 말투는 문장 자체로 만든다.
import { writeFile } from 'node:fs/promises'

import { errorText, ServerError } from './ltx.mjs'

const MAX_TEXT = 500

export function qwenSpeech({ baseUrl, token, fetchImpl = fetch }) {
  if (!baseUrl) throw new Error('QWEN_TTS_URL is not set — run: shorts-director init --ltx-url <url> --tts-url <url> (saved once for this PC)')
  if (!token) throw new Error('QWEN_TTS_TOKEN is not set — set it in the repository root .env or put the token in ~/.config/shorts-director/tts-token (one line)')
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/tts/speech`

  return async function speak(out, { text, language = 'auto', speaker }) {
    if (text.length > MAX_TEXT) throw new Error(`TTS line is ${text.length} characters — split it (max ${MAX_TEXT})`)
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ text, language, ...(speaker ? { speaker } : {}) }),
      signal: AbortSignal.timeout(300_000),
    })
    if (!response.ok) throw new ServerError('Qwen TTS', response.status, await errorText(response))
    await writeFile(out, Buffer.from(await response.arrayBuffer()))
  }
}
