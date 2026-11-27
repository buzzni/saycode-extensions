import assert from 'node:assert/strict'
import { test } from 'node:test'

import { captionBox, captionEvents } from '../lib/captions.mjs'
import { bandLayout, bandRange, bandSlots, frameDesigns } from '../lib/formats.mjs'
import { validatePlan } from '../lib/plan.mjs'

const FRAMES = [
  {
    id: 'steps-clean', name: '단계', suits: '튜토리얼', content: 'square', radius: 24,
    headline: { ink: '#FFFFFF', fill: '#1A6FA3', emphasis: '#FFE066' },
    subtitle: { ink: '#0E1624', fill: '#FFFFFFE6' },
    badge: { ink: '#FFFFFF', fill: '#E4572E' },
    background: '#EEF3F8',
  },
  {
    id: 'app-device', name: '앱 화면', suits: '앱 소개', content: 'portrait', radius: 40,
    headline: { ink: '#FFFFFF' },
    subtitle: { ink: '#FFFFFF', outline: '#101622' },
    badge: { ink: '#101622', fill: '#7CF5C4' },
    background: '#101622',
  },
]

const moments = [
  { id: 'm1', kind: 'take', seconds: 3, caption: { text: '물 끓기 전에 소금', role: 'hook', emphasis: '소금' }, badge: '1' },
  { id: 'm2', kind: 'photo', seconds: 2, caption: { text: '면은 7분', role: 'title' }, badge: '2' },
]

test('a full-screen plan has no band layout, so every short does not have to look the same', () => {
  assert.equal(bandLayout({ moments }, { width: 1080, height: 1920 }, FRAMES), null)
  assert.equal(bandLayout({ moments, format: { layout: 'full' } }, { width: 1080, height: 1920 }, FRAMES), null)
})

test('a band plan puts the video in the frame window, scaled to the render size and even-sized', () => {
  const square = bandLayout({ format: { layout: 'band', frame: 'steps-clean' } }, { width: 1080, height: 1920 }, FRAMES)
  assert.deepEqual(square.content, { x: 48, y: 430, w: 984, h: 984, radius: 24 })
  const portrait = bandLayout({ format: { layout: 'band', frame: 'app-device' } }, { width: 540, height: 960 }, FRAMES)
  assert.deepEqual(portrait.content, { x: 70, y: 210, w: 400, h: 500, radius: 20 })
})

test('in a band the headline stays for the whole video in place of the hook box, and numbers sit on the window corner', () => {
  const plan = { moments, format: { layout: 'band', frame: 'steps-clean', headline: { text: '파스타 3단계', emphasis: '3단계' } } }
  const events = captionEvents(plan, [{ text: '물이 끓기 전에 소금을 넣어요.', start: 0.2, end: 2.6 }], FRAMES[0])
  const headline = events.find((event) => event.role === 'headline')
  assert.deepEqual([headline.text, headline.start, headline.end, headline.emphasis], ['파스타 3단계', 0, 5, '3단계'])
  assert.equal(events.some((event) => event.role === 'hook'), false, 'the hook box would repeat the headline')
  const badges = events.filter((event) => event.role === 'badge')
  assert.deepEqual(badges.map((event) => [event.text, event.start, event.end]), [['1', 0, 3], ['2', 3, 5]])
  const slots = bandSlots(FRAMES[0])
  assert.deepEqual(badges[0].slot, slots.badge)
  assert.deepEqual(events.find((event) => event.role === 'narration').slot, slots.subtitle)
  assert.deepEqual(events.find((event) => event.role === 'title').slot, slots.title)
  assert.equal(headline.look.fill, '#1A6FA3', 'the headline takes the frame colours')
})

test('without a headline the first hook caption becomes the band headline', () => {
  const plan = { moments, format: { layout: 'band', frame: 'steps-clean' } }
  const headline = captionEvents(plan, [], FRAMES[0]).find((event) => event.role === 'headline')
  assert.deepEqual([headline.text, headline.emphasis], ['물 끓기 전에 소금', '소금'])
})

test('a slot places the box by its centre from the top, and a badge by its centre point', () => {
  const box = captionBox({ text: '1', role: 'badge', slot: { center: 0.25, cx: 0.1 } }, { width: 1080, height: 1920 })
  assert.equal(box.align, 'at')
  assert.equal(box.cx, 108)
  assert.ok(Math.abs(box.y + box.h / 2 - 1920 * 0.75) <= 1, 'centred on the slot (AppKit measures y from the bottom)')
})

test('in a band a caption moved off a face stays inside the window, never over the headline or subtitle bands', () => {
  const [low, high] = bandRange(FRAMES[0])
  assert.ok(low > 405 / 1920 && high < 1440 / 1920, `${low}..${high}`)
  const [portraitLow, portraitHigh] = bandRange(FRAMES[1])
  assert.ok(portraitLow > 420 / 1920 && portraitHigh < 1420 / 1920)
})

test('frame colours replace the look box, outline and highlighter so they do not mix', () => {
  const { headline, subtitle } = frameDesigns(FRAMES[1])
  assert.equal(headline.fill, undefined)
  assert.equal(headline.outline, undefined)
  assert.equal(subtitle.outline, '#101622')
})

test('check refuses an unknown layout or frame, a band without a headline, and a long badge', () => {
  const base = {
    version: 1, title: 't', aspect: '9:16', target_seconds: 5,
    hook: { options: [{ line: 'a', mechanism: 'loss', question: 'q' }, { line: 'b', mechanism: 'gap', question: 'q' }, { line: 'c', mechanism: 'proof', question: 'q' }], chosen: 0 },
    moments: [{ id: 'm1', kind: 'card', seconds: 5, shots: [{ seconds: 5, framing: 'card', action: 'text' }], caption: { text: '카드', role: 'info' }, badge: '첫 번째 단계' }],
  }
  const codes = (plan) => validatePlan(plan, { frames: FRAMES }).issues.filter((issue) => issue.level === 'error').map((issue) => issue.code)
  assert.ok(codes({ ...base, format: { layout: 'split' } }).includes('format.layout'))
  assert.ok(codes({ ...base, format: { layout: 'band', frame: 'nope' } }).includes('format.frame'))
  assert.ok(codes({ ...base, format: { layout: 'band', frame: 'steps-clean' } }).includes('format.headline'))
  assert.ok(codes({ ...base, format: { layout: 'band', frame: 'steps-clean', headline: { text: '제목' } } }).includes('badge'))
})

test('check refuses a band caption placed over the headline or subtitle band', () => {
  const plan = {
    version: 1, title: 't', aspect: '9:16', target_seconds: 5,
    hook: { options: [{ line: 'a', mechanism: 'loss', question: 'q' }, { line: 'b', mechanism: 'gap', question: 'q' }, { line: 'c', mechanism: 'proof', question: 'q' }], chosen: 0 },
    format: { layout: 'band', frame: 'steps-clean', headline: { text: '제목' } },
    moments: [{ id: 'm1', kind: 'card', seconds: 5, shots: [{ seconds: 5, framing: 'card', action: 'text' }], caption: { text: '카드', role: 'info', position: { y: 0.15 } } }],
  }
  const codes = validatePlan(plan, { frames: FRAMES }).issues.filter((issue) => issue.level === 'error').map((issue) => issue.code)
  assert.ok(codes.includes('format.position'))
  plan.moments[0].caption.position.y = 0.5
  assert.ok(!validatePlan(plan, { frames: FRAMES }).issues.some((issue) => issue.code === 'format.position'))
})
