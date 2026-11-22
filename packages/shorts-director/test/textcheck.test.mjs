import assert from 'node:assert/strict'
import { test } from 'node:test'

import { croppedHeads, textProblems } from '../lib/textcheck.mjs'

// 상자·얼굴·대상은 모두 화면 비율(0~1), 위에서부터 잰다.
const face = { x: 0.45, y: 0.3, w: 0.15, h: 0.08 }
const product = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }

test('a caption over more than 15% of a face is reported', () => {
  const over = textProblems({ box: { x: 0.4, y: 0.3, w: 0.3, h: 0.06 }, faces: [face], subjects: [] })
  assert.deepEqual(over.map((problem) => problem.kind), ['face'])
  assert.ok(over[0].share > 0.15)
  assert.deepEqual(textProblems({ box: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, faces: [face], subjects: [] }), [])
  const twice = textProblems({ box: { x: 0.4, y: 0.3, w: 0.3, h: 0.06 }, faces: [face, { ...face, y: 0.31 }], subjects: [] })
  assert.equal(twice.length, 1, 'the same face seen in several frames is one problem, at its worst')
})

test('a caption over more than a quarter of the middle of the main subject is reported, its edges may be covered', () => {
  const middle = textProblems({ box: { x: 0.25, y: 0.4, w: 0.5, h: 0.2 }, faces: [], subjects: [product] })
  assert.deepEqual(middle.map((problem) => problem.kind), ['subject'])
  const edge = textProblems({ box: { x: 0.25, y: 0.2, w: 0.5, h: 0.06 }, faces: [], subjects: [product] })
  assert.deepEqual(edge, [], 'the top edge of the subject can carry a title')
})

test('a caption that runs past the side margins is reported', () => {
  const wide = textProblems({ box: { x: 0.01, y: 0.1, w: 0.98, h: 0.05 }, faces: [], subjects: [] })
  assert.deepEqual(wide.map((problem) => problem.kind), ['edge'])
})

// 사람 영역 격자(위에서부터 한 줄씩, # = 사람). 27칸 × 몇 줄이면 충분하다.
function grid(...rows) {
  return { rows: rows.length, cols: rows[0].length, lines: rows }
}

test('a face cut off by the top of the frame is found from the person outline when the face detector misses it', () => {
  const closeUp = grid(
    '......#################....',
    '...#######################.',
    '###########################',
    '###########################',
  )
  const [head] = croppedHeads(closeUp, [], { aspect: 1080 / 1920 })
  assert.ok(head, 'a head is assumed where the person touches the top edge')
  assert.ok(Math.abs(head.x - 6 / 27) < 0.01 && Math.abs(head.w - 17 / 27) < 0.01, `across the top run (${head.x}, ${head.w})`)
  assert.equal(head.y, 0)
  assert.ok(Math.abs(head.h - 1.25 * (17 / 27) * (1080 / 1920)) < 0.01, `as tall as a head that wide (${head.h})`)
  const hook = { x: 0.2, y: 0.1, w: 0.6, h: 0.14 }
  assert.deepEqual(textProblems({ box: hook, faces: [head], subjects: [] }).map((problem) => problem.kind), ['face'])
})

test('no head is assumed when the face detector already found it, nobody touches the top, or the whole top is body', () => {
  const closeUp = grid('......#################....', '###########################')
  assert.deepEqual(croppedHeads(closeUp, [{ x: 0.3, y: 0, w: 0.3, h: 0.1 }], { aspect: 0.5625 }), [], 'the detected face covers it')
  assert.deepEqual(croppedHeads(grid('...........................', '.....#####.................'), [], { aspect: 0.5625 }), [])
  assert.deepEqual(croppedHeads(grid('###########################', '###########################'), [], { aspect: 0.5625 }), [], 'shoulders across the whole top are not a head')
})

// 27칸 × 24줄 격자를 만든다: rows 는 { 줄 번호: 그 줄 }, 나머지 줄은 비어 있다.
function frame(rows) {
  return grid(...Array.from({ length: 24 }, (_, index) => rows[index] ?? '.'.repeat(27)))
}

test('a face cut off by the left or right edge is found where the person first touches that edge at their top', () => {
  const head = '########...................'
  const leftCut = frame({ 6: '#####......................', 7: head, 8: head, 9: head, 10: head, 11: '######.....................', 12: '##########.................' })
  const [left] = croppedHeads(leftCut, [], { aspect: 0.5625 })
  assert.ok(left, 'a head cut by the left edge')
  assert.equal(left.x, 0)
  assert.ok(Math.abs(left.y - 6 / 24) < 0.01, `starts where the person starts (${left.y})`)
  assert.ok(Math.abs(left.w - 8 / 27) < 0.01, `as wide as it shows (${left.w})`)

  const mirrored = frame(Object.fromEntries(Object.entries(leftCut.lines).map(([row, line]) => [row, [...line].reverse().join('')])))
  const [right] = croppedHeads(mirrored, [], { aspect: 0.5625 })
  assert.ok(right && Math.abs(right.x + right.w - 1) < 0.01, 'a head cut by the right edge')
})

test('an arm or shoulder touching the side below a head that is inside the frame is not a head', () => {
  const body = frame({
    4: '...........#####...........',
    5: '..........#######..........',
    6: '..........#######..........',
    8: '.......#############.......',
    12: '####################.......',
    13: '#####################......',
  })
  assert.deepEqual(croppedHeads(body, [], { aspect: 0.5625 }), [])
})

test('a raised hand reaching over the top edge is not taken for a cut-off head', () => {
  const raisedHand = grid('...########################', '...######################..', '#####################......')
  assert.equal(croppedHeads(raisedHand, [], { aspect: 0.5625 }).length, 1, 'without hands it looks like a head')
  const hand = { x: 0.11, y: 0, w: 0.6, h: 0.4 }
  assert.deepEqual(croppedHeads(raisedHand, [], { aspect: 0.5625, hands: [hand] }), [])
})

test('a head cut by the side is as wide as the widest part showing near its top, not just its first row of hair', () => {
  const narrowHair = frame({
    3: '####.......................',
    4: '######.....................',
    5: '#########..................',
    6: '##########.................',
    7: '##########.................',
    8: '#########..................',
  })
  const [head] = croppedHeads(narrowHair, [], { aspect: 0.5625 })
  assert.ok(Math.abs(head.w - 10 / 27) < 0.01, `widest of the first rows (${head.w})`)
})

test('a head cut by the side reaches down to the neck, where the outline narrows before the shoulders', () => {
  const profile = frame({
    2: '#######....................',
    3: '#########..................',
    4: '##########.................',
    5: '###########................',
    6: '###########................',
    7: '###########................',
    8: '##########.................',
    9: '##########.................',
    10: '#########..................',
    11: '#########..................',
    12: '########...................',
    13: '#############..............',
    14: '#################..........',
  })
  const [head] = croppedHeads(profile, [], { aspect: 0.5625 })
  assert.ok(Math.abs(head.y - 2 / 24) < 0.01)
  assert.ok(Math.abs(head.y + head.h - 13 / 24) < 0.01, `down to the neck at row 12 (${head.y + head.h})`)
  assert.ok(Math.abs(head.w - 11 / 27) < 0.01, `as wide as the cheeks (${head.w})`)
})
