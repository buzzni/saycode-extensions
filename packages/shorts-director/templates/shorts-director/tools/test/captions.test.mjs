import assert from 'node:assert/strict'
import { test } from 'node:test'

import { captionBox, captionEvents, layoutNarration, wrapLine } from '../lib/captions.mjs'

test('narration lines are laid out back to back from measured durations with a breath gap', () => {
  const timed = layoutNarration([{ text: '하나', seconds: 1.2 }, { text: '둘', seconds: 0.8 }], { start: 0.5, gap: 0.3 })
  assert.deepEqual(timed.map((line) => [line.start, line.end]), [[0.5, 1.7], [2, 2.8]])
})

test('caption lines wrap at about eight Korean characters per line, at most three lines', () => {
  assert.deepEqual(wrapLine('비 오는 날 퇴근길에 우산 없이', 8), ['비 오는 날', '퇴근길에', '우산 없이'])
  assert.deepEqual(wrapLine('우산 없이 나온 날', 8), ['우산 없이', '나온 날'], 'no orphan word on the last line')
  assert.equal(wrapLine('가'.repeat(40), 8).length, 3)
})

test('caption boxes keep inside the safe area: below the top 10%, above the bottom 18%, off the side edges', () => {
  const size = { width: 1080, height: 1920 }
  const hook = captionBox({ text: '비 오는 날 퇴근길에 우산 없이', role: 'hook' }, size)
  const hookTopFromTop = size.height - (hook.y + hook.h)
  assert.ok(hookTopFromTop >= size.height * 0.1, 'hook below the top 10%')
  assert.equal(hook.text, '비 오는 날\n퇴근길에\n우산 없이')
  const narration = captionBox({ text: '우산 없이 나와 본 적 있죠', role: 'narration' }, size)
  assert.ok(narration.y >= size.height * 0.18, 'narration above the bottom 18%')
  for (const box of [hook, narration]) {
    assert.ok(box.x >= size.width * 0.05)
    assert.ok(box.x + box.w <= size.width * 0.95)
  }
  assert.ok(hook.fontSize > narration.fontSize, 'the hook title is the biggest text')
})

test('caption events: moment captions span their moment, narration lines become subtitles', () => {
  const plan = {
    moments: [
      { id: 'm1', seconds: 8, caption: { text: '훅', role: 'hook' } },
      { id: 'm2', seconds: 4, subtitles: [{ text: '대사', at: 1, seconds: 1.5 }] },
    ],
  }
  const events = captionEvents(plan, [{ text: '내레이션', start: 0.2, end: 2 }])
  assert.deepEqual(events, [
    { text: '훅', role: 'hook', start: 0, end: 8 },
    { text: '대사', role: 'dialogue', start: 9, end: 10.5 },
    { text: '내레이션', role: 'narration', start: 0.2, end: 2 },
  ])
  assert.deepEqual(captionEvents({ ...plan, subtitles: false }, [{ text: '내레이션', start: 0, end: 1 }]).map((event) => event.role), ['hook', 'dialogue'])
})
