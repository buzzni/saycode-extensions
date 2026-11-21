import assert from 'node:assert/strict'
import { test } from 'node:test'

import { countTakes, planSeconds, validatePlan } from '../lib/plan.mjs'

function shots(count, seconds) {
  return Array.from({ length: count }, (_, index) => ({ seconds, framing: `f${index}`, action: 'a' }))
}

function goodPlan() {
  return {
    version: 1,
    title: '퇴근길 우산',
    language: 'ko',
    aspect: '9:16',
    target_seconds: 30,
    hook: { options: ['A', 'B', 'C'], chosen: 1 },
    subjects: [{ id: 'hero', kind: 'person', look: 'Korean office worker in her 30s, beige trench coat' }],
    moments: [
      { id: 'm1', kind: 'take', place: 'subway exit', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p1' },
      { id: 'm2', kind: 'take', place: 'stairs', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p2' },
      { id: 'm3', kind: 'take', place: 'bus stop', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p3' },
      { id: 'm4', kind: 'photo', file: 'materials/umbrella.jpg', seconds: 3, shots: shots(1, 3) },
      { id: 'm5', kind: 'take', place: 'shop', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p4' },
      { id: 'm6', kind: 'take', place: 'home door', seconds: 4, subjects: ['hero'], shots: shots(2, 2), video_prompt: 'p5' },
      { id: 'm7', kind: 'card', seconds: 3, shots: shots(1, 3), caption: { text: '오늘 밤 비 90%', role: 'info' } },
    ],
    narration: [{ text: '비 오는 날 퇴근길, 우산 없이 나와 본 적 있죠?' }],
  }
}

function codes(plan) {
  return validatePlan(plan).issues.map((issue) => issue.code)
}

test('a plan that follows the shortform rules has no errors', () => {
  const result = validatePlan(goodPlan())
  assert.deepEqual(result.issues.filter((issue) => issue.level === 'error'), [])
  assert.equal(result.ok, true)
  assert.equal(planSeconds(goodPlan()), 30)
  assert.equal(countTakes(goodPlan()), 5)
})

test('the hook question must offer three or four options and record the choice', () => {
  const plan = goodPlan()
  plan.hook = { options: ['only one'], chosen: 0 }
  assert.ok(codes(plan).includes('hook.options'))
  plan.hook = { options: ['A', 'B', 'C'] }
  assert.ok(codes(plan).includes('hook.chosen'))
})

test('the video must not open on a text-only card', () => {
  const plan = goodPlan()
  plan.moments.unshift({ id: 'm0', kind: 'card', seconds: 2, shots: shots(1, 2), caption: { text: '안녕하세요', role: 'title' } })
  plan.moments.at(-1).seconds = 1
  plan.moments.at(-1).shots = shots(1, 1)
  assert.ok(codes(plan).includes('opening.card'))
})

test('too few cuts for the length reads as a slideshow', () => {
  const plan = goodPlan()
  for (const moment of plan.moments) {
    moment.shots = shots(1, moment.seconds)
  }
  assert.ok(codes(plan).includes('pace.cuts'))
})

test('a shot longer than four seconds is flagged', () => {
  const plan = goodPlan()
  plan.moments[0].shots = [{ seconds: 4.5, framing: 'wide', action: 'a' }, { seconds: 0.5, framing: 'close', action: 'b' }]
  assert.ok(codes(plan).includes('pace.shot'))
})

test('take shots must add up to the take length', () => {
  const plan = goodPlan()
  plan.moments[0].shots = shots(2, 2)
  assert.ok(codes(plan).includes('take.shots_sum'))
})

test('take length must fit the backend limits (LTX: up to 5 seconds per generation)', () => {
  const plan = goodPlan()
  plan.moments[0].seconds = 6
  plan.moments[0].shots = shots(3, 2)
  assert.ok(codes(plan).includes('take.seconds'))
  assert.ok(!validatePlan(plan, { take: { min: 1, max: 10 } }).issues.some((issue) => issue.code === 'take.seconds'))
})

test('a take can start from an earlier take only, and from a real photo only under materials/', () => {
  const plan = goodPlan()
  plan.moments[1].from = { take: 'm1' }
  assert.ok(!codes(plan).includes('take.from'))
  plan.moments[1].from = { take: 'm3' }
  assert.ok(codes(plan).includes('take.from'), 'a later take cannot be the starting frame')
  plan.moments[1].from = { file: 'stills/x.png' }
  assert.ok(codes(plan).includes('take.from'))
  plan.moments[1].from = { file: 'materials/me.jpg' }
  assert.ok(!codes(plan).includes('take.from'))
})

test('a hard cut inside a chained take loses the face, so it is warned', () => {
  const plan = goodPlan()
  plan.moments[1].from = { take: 'm1' }
  plan.moments[1].shots[1].transition = 'cut'
  const issue = validatePlan(plan).issues.find((item) => item.code === 'take.cut_after_anchor')
  assert.equal(issue?.level, 'warning')
  plan.moments[1].shots[1].transition = 'move'
  assert.ok(!codes(plan).includes('take.cut_after_anchor'))
})

test('moment ids and file paths cannot leave the project folder', () => {
  const plan = goodPlan()
  plan.moments[0].id = '../../evil'
  assert.ok(codes(plan).includes('moment.id'))
  const second = goodPlan()
  second.moments[3].file = 'materials/../../.ssh/id_ed25519'
  assert.ok(codes(second).includes('photo.real'))
  const third = goodPlan()
  third.moments[1].from = { file: 'materials/../secret.png' }
  assert.ok(codes(third).includes('take.from'))
  const fourth = goodPlan()
  fourth.moments.at(-1).background = 'black,drawbox'
  assert.ok(codes(fourth).includes('card.background'))
})

test('camera moves over stills are only for real photos from materials/', () => {
  const plan = goodPlan()
  plan.moments[3].file = 'stills/generated.png'
  assert.ok(codes(plan).includes('photo.real'))
})

test('unknown subjects are rejected', () => {
  const plan = goodPlan()
  plan.moments[0].subjects = ['ghost']
  assert.ok(codes(plan).includes('subject.unknown'))
})

test('asking the video model for no subtitles makes it draw fake lettering, so those words are rejected', () => {
  const plan = goodPlan()
  plan.moments[0].video_prompt = 'rainy street. No text, no subtitles, no music.'
  assert.ok(codes(plan).includes('prompt.text_words'))
  plan.moments[0].video_prompt = 'rainy street'
  plan.moments[0].shots[0].action = 'a caption appears'
  assert.ok(codes(plan).includes('prompt.text_words'))
})

test('prices and numbers inside a video prompt are warned to move to overlays', () => {
  const plan = goodPlan()
  plan.moments[0].video_prompt = 'a sign that says 9,900원'
  const issue = validatePlan(plan).issues.find((item) => item.code === 'prompt.numbers')
  assert.equal(issue?.level, 'warning')
})

test('a subscribe or like ending is warned', () => {
  const plan = goodPlan()
  plan.moments.at(-1).caption = { text: '구독과 좋아요 부탁해요', role: 'info' }
  assert.ok(codes(plan).includes('ending.tail'))
})

test('narration far longer than the video can carry is warned before TTS', () => {
  const plan = goodPlan()
  plan.narration = [{ text: '가'.repeat(400) }]
  assert.ok(codes(plan).includes('narration.length'))
})

test('total length far from the target is flagged', () => {
  const plan = goodPlan()
  plan.target_seconds = 60
  assert.ok(codes(plan).includes('length.target'))
})
