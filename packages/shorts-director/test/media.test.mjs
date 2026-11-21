import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { probe, tightenSpeech } from '../lib/media.mjs'

const exec = promisify(execFile)
const hasFfmpeg = await exec('ffmpeg', ['-version']).then(() => true, () => false)

test('speech is trimmed at both ends and long inner pauses are shortened', { skip: !hasFfmpeg && 'needs ffmpeg' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-media-'))
  try {
    // 1.2초 침묵 + 1초 말 + 0.9초 쉼 + 1초 말 + 0.9초 침묵 (Qwen TTS 실측 모양)
    const raw = join(root, 'raw.wav')
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i',
      'anullsrc=r=24000:cl=mono:d=1.2[a];sine=f=300:r=24000:d=1[b];anullsrc=r=24000:cl=mono:d=0.9[c];sine=f=300:r=24000:d=1[d];anullsrc=r=24000:cl=mono:d=0.9[e];[a][b][c][d][e]concat=n=5:v=0:a=1',
      raw])
    const tight = join(root, 'tight.wav')
    await tightenSpeech(raw, tight)
    const { duration } = await probe(tight)
    assert.ok(duration > 2.1 && duration < 2.6, `expected about 2.3s of speech with a short pause, got ${duration}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
