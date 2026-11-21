// 가짜 백엔드: 서버 호출 없이 흐름 전체를 리허설한다. 결과물은 테스트 패턴과 삐 소리다.
import { ffmpeg } from '../media.mjs'

// fail: 실패를 흉내 낼 장면 id 목록(config.fake = { fail: [...] }) — 실패 전파를 리허설한다.
export function fakeVideoBackend({ video, fail = [] }) {
  return {
    name: 'fake',
    async submit(take) {
      return { remoteId: `fake-${take.momentId}-${Date.now()}` }
    },
    async poll(job, { saveTo }) {
      if (fail.includes(job.momentId)) return { status: 'failed', reason: 'fake failure' }
      const seconds = String(job.take.seconds)
      await ffmpeg([
        '-f', 'lavfi', '-i', `testsrc2=s=${video.width}x${video.height}:r=${video.fps}:d=${seconds}`,
        '-f', 'lavfi', '-i', `sine=frequency=220:duration=${seconds}`,
        '-af', 'volume=0.2', '-shortest', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', saveTo,
      ])
      return { status: 'completed' }
    },
  }
}

export async function fakeSpeech(out, { text }) {
  const seconds = Math.max(0.6, String(text).replace(/\s/g, '').length / 6).toFixed(2)
  await ffmpeg(['-f', 'lavfi', '-i', `sine=frequency=330:duration=${seconds}`, '-af', 'volume=0.15', '-ar', '24000', '-ac', '1', out])
}
