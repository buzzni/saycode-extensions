import assert from 'node:assert/strict'
import { test } from 'node:test'

import { captionBox, captionEvents, layoutNarration, scenesLongerThanSpeech, speechPastScene, speechTempo, subtitleChunks, wrapLine } from '../lib/captions.mjs'

test('narration lines are laid out back to back from measured durations with a breath gap', () => {
  const timed = layoutNarration([{ text: '하나', seconds: 1.2 }, { text: '둘', seconds: 0.8 }], { start: 0.5, gap: 0.3 })
  assert.deepEqual(timed.map((line) => [line.start, line.end]), [[0.5, 1.7], [2, 2.8]])
})

test('a narration line pinned to a moment waits for that moment to start', () => {
  const timed = layoutNarration(
    [{ text: '하나', seconds: 2 }, { text: '둘', seconds: 1, minStart: 9 }, { text: '셋', seconds: 1, minStart: 1 }],
    { start: 0.2, gap: 0.3 },
  )
  assert.deepEqual(timed.map((line) => [line.start, line.end]), [[0.2, 2.2], [9, 10], [10.3, 11.3]])
})

test('slow narration is sped up toward about 6.5 syllables a second, never past 1.25x', () => {
  assert.equal(speechTempo('빨래 한 번 널면, 내 방에 내 자리가 없어요.', 3.5), 1.25, '16 syllables in 3.5s (4.6/s) is capped at 1.25x')
  assert.ok(Math.abs(speechTempo('원목 접이식 건조대예요.', 1.7) - 6.5 / (10 / 1.7)) < 0.001, '10 syllables in 1.7s (5.9/s) goes up to 6.5/s')
  assert.equal(speechTempo('범인은 양말이었다', 1), 1, 'already fast lines stay as they are')
})

test('a scene that runs well past its narration is reported, because the gap is dead air', () => {
  const plan = { moments: [{ id: 'm1', seconds: 4 }, { id: 'm2', seconds: 5 }, { id: 'm3', seconds: 3 }] }
  const lines = [
    { text: 'a', start: 0.2, end: 3.6, moment: 'm1' },
    { text: 'b', start: 4.2, end: 6.5, moment: 'm2' },
    { text: 'c', start: 9.2, end: 11.9, moment: 'm3' },
  ]
  assert.deepEqual(scenesLongerThanSpeech(plan, lines), [{ id: 'm2', idle: 2.5 }])
})

test('speech that runs into the next scene is reported, because its subtitle shows over that scene', () => {
  const plan = { moments: [{ id: 'm1', seconds: 4 }, { id: 'm2', seconds: 3 }, { id: 'm3', seconds: 3 }, { id: 'm4', seconds: 3 }] }
  const lines = [
    { text: 'a', start: 0.2, end: 3.6, moment: 'm1' },
    { text: 'b', start: 4.2, end: 8.1, moment: 'm2' },
    { text: 'c', start: 8.2, end: 9.5, moment: 'm3' },
    { text: 'd', start: 9.6, end: 11.4 },
  ]
  assert.deepEqual(speechPastScene(plan, lines), [{ id: 'm2', into: 'm3', over: 1.1, text: 'b' }],
    'm3 has its own line, so b running 1.1s into m3 is a mistake; d carrying on into m4 without a line of its own is not')
  const twoLinesOneScene = [{ text: 'a', start: 0.2, end: 1.8, moment: 'm1' }, { text: 'b', start: 1.9, end: 3.5, moment: 'm1' }]
  assert.deepEqual(speechPastScene(plan, twoLinesOneScene), [], 'a second line pinned to the same scene simply follows the first')
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
  assert.equal(hook.text, '비 오는 날\n퇴근길에 우산 없이', 'a boxed title keeps to two lines')
  const narration = captionBox({ text: '우산 없이 나와 본 적 있죠', role: 'narration' }, size)
  assert.ok(narration.y >= size.height * 0.18, 'narration above the bottom 18%')
  for (const box of [hook, narration]) {
    assert.ok(box.x >= size.width * 0.05)
    assert.ok(box.x + box.w <= size.width * 0.95)
  }
  assert.ok(hook.fontSize > narration.fontSize, 'the hook title is the biggest text')
})

test('caption events: the hook title shows for the first three seconds, other captions span their moment, narration becomes subtitles', () => {
  const plan = {
    moments: [
      { id: 'm1', seconds: 8, caption: { text: '훅', role: 'hook' } },
      { id: 'm2', seconds: 4, subtitles: [{ text: '대사', at: 1, seconds: 1.5 }] },
    ],
  }
  const events = captionEvents(plan, [{ text: '내레이션', start: 0.2, end: 2 }])
  assert.deepEqual(events, [
    { text: '훅', role: 'hook', start: 0, end: 3 },
    { text: '대사', role: 'dialogue', start: 9, end: 10.5 },
    { text: '내레이션', role: 'narration', start: 0.2, end: 2 },
  ])
  assert.deepEqual(captionEvents({ ...plan, subtitles: false }, [{ text: '내레이션', start: 0, end: 1 }]).map((event) => event.role), ['hook', 'dialogue'])
})

test('narration subtitles change in one-line pieces of about fifteen characters, cut at commas first, timed by syllables', () => {
  const pieces = subtitleChunks({ text: '근데 범인은 빨래가 아니라, 하루 종일 펼쳐 둔 건조대였어요.', start: 6.7, end: 10.58 })
  assert.deepEqual(pieces.map((piece) => piece.text), ['근데 범인은 빨래가 아니라,', '하루 종일 펼쳐 둔 건조대였어요.'])
  assert.equal(pieces[0].start, 6.7)
  assert.equal(pieces.at(-1).end, 10.58)
  assert.ok(Math.abs(pieces[0].end - pieces[1].start) < 0.001, 'pieces follow each other')
  assert.ok(Math.abs((pieces[0].end - 6.7) / (10.58 - 6.7) - 11 / 24) < 0.01, 'time split by syllables (11 of 24)')

  const long = subtitleChunks({ text: '미니 건조대는 창가에 세워 걸고 다 마르면 납작하게 접어 틈새에 쏙', start: 0, end: 4 })
  assert.deepEqual(long.map((piece) => piece.text), ['미니 건조대는 창가에 세워 걸고', '다 마르면 납작하게 접어 틈새에 쏙'], 'a one-syllable word goes with the word it modifies')
})

test('captions carry their look: boxed hook with an emphasised word and a label, a chip for info, one-line subtitles low in the frame', () => {
  const size = { width: 1080, height: 1920 }
  const events = captionEvents({ moments: [
    { id: 'm1', seconds: 4, caption: { text: '빨래 널면 방이 사라짐', role: 'hook', emphasis: '사라짐', label: '원룸 자취 3년 차' } },
    { id: 'm2', seconds: 3, caption: { text: '납작하게 접힘', role: 'info' } },
  ] }, [{ text: '빨래 한 번 널면, 원룸이 통째로 사라져요.', start: 0.2, end: 2.7 }])
  const hook = events.find((event) => event.role === 'hook')
  assert.equal(hook.emphasis, '사라짐')
  assert.equal(hook.label, '원룸 자취 3년 차')
  assert.equal(captionBox(hook, size).style, 'box')
  assert.equal(captionBox(events.find((event) => event.role === 'info'), size).style, 'chip')
  const subtitles = events.filter((event) => event.role === 'narration')
  assert.ok(subtitles.length >= 2, 'the narration line is split into pieces')
  for (const event of subtitles) {
    const box = captionBox(event, size)
    assert.equal(box.style, 'subtitle')
    assert.ok(!box.text.includes('\n'), `one line: ${box.text}`)
    const centreFromTop = 1 - (box.y + box.h / 2) / size.height
    assert.ok(centreFromTop > 0.72 && centreFromTop < 0.77, `subtitle centre about 74.5% down (${centreFromTop})`)
  }
})

test('an info chip over footage sits in the upper third so it does not cover the subject; on a text card it is centred', () => {
  const size = { width: 1080, height: 1920 }
  const events = captionEvents({ moments: [
    { id: 'm1', kind: 'take', seconds: 3, caption: { text: '창가 = 바람길', role: 'info' } },
    { id: 'm2', kind: 'card', seconds: 2, caption: { text: '오늘 밤 비 90%', role: 'info' } },
  ] })
  const centreFromTop = (event) => {
    const box = captionBox(event, size)
    return 1 - (box.y + box.h / 2) / size.height
  }
  const overFootage = centreFromTop(events[0])
  assert.ok(overFootage > 0.25 && overFootage < 0.35, `chip over footage at about 30% (${overFootage})`)
  assert.ok(Math.abs(centreFromTop(events[1]) - 0.5) < 0.01, 'chip on a card is centred')
})

test('asides (inner voice, status, commentary) appear at their moment for their seconds, a little below the upper titles', () => {
  const size = { width: 1080, height: 1920 }
  const events = captionEvents({ moments: [
    { id: 'm1', seconds: 3 },
    { id: 'm2', seconds: 4, asides: [{ text: '(당황)', at: 0.5, seconds: 1.2 }, { text: '아 망했다..', at: 2 }] },
  ] })
  assert.deepEqual(events.map((event) => [event.role, event.text, event.start, event.end]), [
    ['aside', '(당황)', 3.5, 4.7],
    ['aside', '아 망했다..', 5, 6.5],
  ])
  const box = captionBox(events[0], size)
  const centreFromTop = 1 - (box.y + box.h / 2) / size.height
  assert.ok(centreFromTop > 0.35 && centreFromTop < 0.45, `aside centre about 40% down (${centreFromTop})`)
})

test('a caption can be placed by hand: vertical centre as a share of the height from the top, and left, centre or right', () => {
  const size = { width: 1080, height: 1920 }
  const [event] = captionEvents({ moments: [
    { id: 'm1', seconds: 3, caption: { text: '창가 = 바람길', role: 'info', position: { y: 0.18, x: 'left' }, look: { fill: '#111111' } } },
  ] })
  assert.deepEqual(event.position, { y: 0.18, x: 'left' })
  assert.deepEqual(event.look, { fill: '#111111' })
  const box = captionBox(event, size)
  const centreFromTop = 1 - (box.y + box.h / 2) / size.height
  assert.ok(Math.abs(centreFromTop - 0.18) < 0.01, `centre at 18% (${centreFromTop})`)
  assert.equal(box.align, 'left')
})
