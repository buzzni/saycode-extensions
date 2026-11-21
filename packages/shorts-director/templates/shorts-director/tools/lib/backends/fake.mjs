// 가짜 백엔드: Google 호출 없이 흐름 전체를 리허설한다. 결과물은 테스트 패턴·단색·삐 소리다.
import { createHash } from 'node:crypto'

import { ffmpeg } from '../media.mjs'

export const fakeVideoBackend = {
  name: 'fake',
  async submit(take) {
    return { remoteId: `fake-${take.momentId}-${Date.now()}` }
  },
  async poll(job, { root, config, saveTo }) {
    const seconds = String(job.take.seconds)
    await ffmpeg([
      '-f', 'lavfi', '-i', `testsrc2=s=${config.width}x${config.height}:r=${config.fps}:d=${seconds}`,
      '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
      '-af', 'volume=0.2', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', saveTo,
    ], { cwd: root })
    return { status: 'completed' }
  },
}

export async function fakeImage(out, { width, height, seed }) {
  const hex = createHash('sha256').update(String(seed)).digest('hex').slice(0, 6)
  await ffmpeg(['-f', 'lavfi', '-i', `color=c=0x${hex}:s=${width}x${height}`, '-frames:v', '1', out])
}

export async function fakeSpeech(out, text) {
  const seconds = Math.max(0.6, String(text).replace(/\s/g, '').length / 6).toFixed(2)
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-af', 'volume=0.15', '-ar', '24000', '-ac', '1', out])
}
