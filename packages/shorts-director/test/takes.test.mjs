import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildTake } from '../lib/takes.mjs'

const config = { video: { width: 576, height: 1024, fps: 24 } }
const plan = {
  title: '퇴근길 우산',
  subjects: [{ id: 'hero', kind: 'person', look: 'a Korean woman in her early thirties, shoulder-length black hair, beige trench coat' }],
}

test('an LTX take is one flowing paragraph: scene, the recurring look, shots joined by hard cuts, speech and sound', () => {
  const moment = {
    id: 'm1',
    kind: 'take',
    place: 'subway exit',
    seconds: 5,
    subjects: ['hero'],
    video_prompt: 'Handheld phone video, rainy evening at a Seoul subway exit, cool streetlight on wet pavement.',
    shots: [
      { seconds: 2, framing: 'wide shot', action: 'she stops at the top of the stairs and stares at the rain' },
      { seconds: 1.5, framing: 'close-up', action: 'her hands dig through an empty tote bag' },
      { seconds: 1.5, framing: 'over the shoulder', action: 'people with umbrellas hurry past' },
    ],
    dialogue: [{ speaker: 'She', text: '아 진짜…' }],
    sound: 'Heavy rain and distant traffic.',
  }
  const take = buildTake(moment, plan, config)
  assert.equal(take.momentId, 'm1')
  assert.equal(take.seconds, 5)
  assert.equal(take.width, 576)
  assert.equal(take.height, 1024)
  assert.equal(take.fps, 24)
  assert.ok(Number.isInteger(take.seed))
  assert.equal(take.prompt, [
    'Handheld phone video, rainy evening at a Seoul subway exit, cool streetlight on wet pavement.',
    'The same person throughout: a Korean woman in her early thirties, shoulder-length black hair, beige trench coat.',
    'Wide shot: she stops at the top of the stairs and stares at the rain.',
    'Hard cut to close-up: her hands dig through an empty tote bag.',
    'Hard cut to over the shoulder: people with umbrellas hurry past.',
    'She says in Korean, "아 진짜…"',
    'Heavy rain and distant traffic.',
  ].join(' '))
})

test('a chained take starts from the previous take and changes shots with camera moves, not cuts', () => {
  const moment = {
    id: 'm2', kind: 'take', seconds: 5, from: { take: 'm1' }, video_prompt: 'Rainy street.',
    shots: [{ seconds: 2.5, framing: 'medium shot', action: 'she runs' }, { seconds: 2.5, framing: 'close-up', action: 'she stops' }],
  }
  const take = buildTake(moment, plan, config)
  assert.deepEqual(take.firstFrame, { take: 'm1', at: 'end' })
  assert.match(take.prompt, /^Continuous shot, no cuts\. Rainy street\./)
  assert.match(take.prompt, /The camera moves to close-up: she stops\./)
  assert.doesNotMatch(take.prompt, /Hard cut/)
  assert.deepEqual(buildTake({ ...moment, from: { file: 'materials/me.jpg' } }, plan, config).firstFrame, { file: 'materials/me.jpg' })
})

test('the seed is stable per moment so a re-run reproduces the same take, and can be pinned', () => {
  const moment = { id: 'm2', kind: 'take', seconds: 3, video_prompt: 'p', shots: [{ seconds: 3, framing: 'wide', action: 'a' }] }
  assert.equal(buildTake(moment, plan, config).seed, buildTake(moment, plan, config).seed)
  assert.notEqual(buildTake(moment, plan, config).seed, buildTake({ ...moment, id: 'm3' }, plan, config).seed)
  assert.equal(buildTake({ ...moment, seed: 42 }, plan, config).seed, 42)
})
