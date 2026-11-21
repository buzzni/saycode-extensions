import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTake } from '../lib/takes.mjs'

const config = { aspect: '9:16', video: { resolution: '720p', quietLine: 'No subtitles. No background music.' } }

test('a take prompt carries the scene, a timed shot list, spoken lines and the quiet line', () => {
  const moment = {
    id: 'm1',
    kind: 'take',
    place: 'subway exit',
    seconds: 6,
    first_frame: { prompt: 'x' },
    video_prompt: 'Rainy evening at a Seoul subway exit, handheld phone camera.',
    shots: [
      { seconds: 2, framing: 'wide', action: 'she stops at the top of the stairs' },
      { seconds: 2.5, framing: 'close-up', action: 'rain hits her face' },
      { seconds: 1.5, framing: 'pov_hands', action: 'she opens an empty bag' },
    ],
    dialogue: [{ speaker: 'the woman', text: '아 진짜…' }],
  }
  const take = buildTake(moment, config)
  assert.equal(take.momentId, 'm1')
  assert.equal(take.seconds, 6)
  assert.equal(take.firstFrame, 'stills/m1.png')
  assert.equal(take.resolution, '720p')
  assert.match(take.prompt, /^Rainy evening/)
  assert.match(take.prompt, /\[0-2s\] wide: she stops/)
  assert.match(take.prompt, /\[2-4\.5s\] close-up: rain hits/)
  assert.match(take.prompt, /\[4\.5-6s\] pov_hands/)
  assert.match(take.prompt, /the woman says in Korean: "아 진짜…"/)
  assert.match(take.prompt, /No background music\.$/)
})

test('a take without a first frame is pure text to video', () => {
  const take = buildTake({ id: 'm2', kind: 'take', seconds: 4, video_prompt: 'p', shots: [{ seconds: 4, framing: 'wide', action: 'a' }] }, config)
  assert.equal(take.firstFrame, undefined)
})
