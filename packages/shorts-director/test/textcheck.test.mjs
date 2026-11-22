import assert from 'node:assert/strict'
import { test } from 'node:test'

import { croppedHeads, cutSides, mirroredFaces, textProblems } from '../lib/textcheck.mjs'

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

test('a face cut by a side is looked for again in a picture with the showing half mirrored onto that side', () => {
  // 왼쪽에 화면 폭의 절반을 덧붙인 그림(폭 1.5배)에서 찾은 얼굴: 덧붙인 곳 0.25 ~ 원래 그림 안까지.
  const [left] = mirroredFaces([{ x: 0.1, y: 0.2, w: 0.4, h: 0.3 }], 'left')
  assert.ok(Math.abs(left.x) < 1e-9 && Math.abs(left.w - (1.5 * 0.5 - 0.5)) < 1e-9, `only the part inside the frame (${left.x}, ${left.w})`)
  assert.deepEqual([left.y, left.h], [0.2, 0.3])
  const [right] = mirroredFaces([{ x: 0.5, y: 0.1, w: 0.3, h: 0.2 }], 'right')
  assert.ok(Math.abs(right.x - 0.75) < 1e-9 && Math.abs(right.x + right.w - 1) < 1e-9, `${right.x}, ${right.w}`)
  assert.deepEqual(mirroredFaces([{ x: 0.5, y: 0.1, w: 0.1, h: 0.1 }], 'left'), [], 'a face wholly inside the frame was already found the normal way')
})

test('the sides worth mirroring are those the person touches in the upper part of the frame', () => {
  const hood = frame({ 3: '...................########', 4: '..................#########', 10: '..........#################' })
  assert.deepEqual(cutSides(hood), ['right'])
  const armOnly = frame({ 3: '..........#####............', 20: '#######....................' })
  assert.deepEqual(cutSides(armOnly), [], 'touching the side only low down is an arm or a lap')
})

test('an arm entering from the side low in the frame is not a head, even when that side has nothing above it', () => {
  const capAndArm = frame({
    0: '.........................##',
    1: '.......................####',
    2: '......................#####',
    3: '.......................####',
    5: '......................#####',
    8: '.................##########',
    17: '###.........###########....',
    18: '########..#########....###.',
  })
  const heads = croppedHeads(capAndArm, [], { aspect: 0.5625 })
  assert.ok(heads.every((head) => head.x > 0.5), `only the head on the right: ${JSON.stringify(heads)}`)
})

test('a sliver of cheek at the side is followed down to where it ends, past the usual head height', () => {
  const widths = [1, 2, 3, 3, 4, 5, 5, 5, 5, 5, 5, 4, 3, 3, 2, 2, 1]
  const sliver = frame(Object.fromEntries(widths.map((width, index) => [index + 2, '#'.repeat(width).padEnd(27, '.')])))
  const [head] = croppedHeads(sliver, [], { aspect: 0.5625 })
  assert.ok(head, 'the ear-and-cheek sliver is a head')
  assert.ok(Math.abs(head.y + head.h - 19 / 24) < 0.01, `down to the end of the sliver at row 18 (${head.y + head.h})`)
})

test('a hand found low in the picture (hood folds can look like one) does not erase a head cut by the side', () => {
  const hood = frame(Object.fromEntries([1, 3, 5, 7, 9, 10, 11, 12, 13, 13, 14, 14, 14].map((width, index) => [index + 3, '#'.repeat(width).padEnd(27, '.')])))
  const folds = { x: 0.19, y: 0.29, w: 0.26, h: 0.67 }
  assert.equal(croppedHeads(hood, [], { aspect: 0.5625, hands: [folds] }).length, 1)
})

// 피부색 격자: 사람 영역 중 피부색인 칸만 's'.
function skinFrame(rows) {
  return { rows: 24, cols: 27, lines: Array.from({ length: 24 }, (_, index) => rows[index] ?? '.'.repeat(27)) }
}

test('a hat or hair at the edge is not a face: the cut-off head is narrowed to the skin inside it', () => {
  const widths = [1, 2, 3, 3, 4, 5, 5, 5, 5, 5, 5, 4, 3, 3, 2, 2, 1]
  const sliver = frame(Object.fromEntries(widths.map((width, index) => [index + 2, '#'.repeat(width).padEnd(27, '.')])))
  // 비니가 2~9줄, 볼이 10~17줄
  const skin = skinFrame(Object.fromEntries([10, 11, 12, 13, 14, 15, 16, 17].map((row) => [row, 'sss'.padEnd(27, '.')])))
  const [face] = croppedHeads(sliver, [], { aspect: 0.5625, skin })
  assert.ok(Math.abs(face.y - 10 / 24) < 0.01, `starts below the hat (${face.y})`)
  assert.ok(Math.abs(face.y + face.h - 18 / 24) < 0.01, `ends with the cheek (${face.y + face.h})`)
  assert.ok(Math.abs(face.w - 3 / 27) < 0.01, `as wide as the skin (${face.w})`)
})

test('a sliver of only hair or hat, with no skin in it, is not a face', () => {
  const widths = [1, 2, 3, 3, 4, 5, 5, 5, 4, 3, 2, 1]
  const hairOnly = frame(Object.fromEntries(widths.map((width, index) => [index + 2, '#'.repeat(width).padEnd(27, '.')])))
  assert.equal(croppedHeads(hairOnly, [], { aspect: 0.5625 }).length, 1, 'without colour it is assumed to be a head')
  assert.deepEqual(croppedHeads(hairOnly, [], { aspect: 0.5625, skin: skinFrame({}) }), [])
})

test('a few skin-coloured specks in a hat (highlights) do not stretch the face up into the hat', () => {
  const widths = [1, 2, 3, 3, 4, 5, 5, 5, 5, 5, 5, 4, 3, 3, 2, 2, 1]
  const sliver = frame(Object.fromEntries(widths.map((width, index) => [index + 2, '#'.repeat(width).padEnd(27, '.')])))
  const skin = skinFrame({
    3: '.s'.padEnd(27, '.'),
    5: '..s'.padEnd(27, '.'),
    ...Object.fromEntries([10, 11, 12, 13, 14, 15, 16, 17].map((row) => [row, 'sss'.padEnd(27, '.')])),
  })
  const [face] = croppedHeads(sliver, [], { aspect: 0.5625, skin })
  assert.ok(Math.abs(face.y - 10 / 24) < 0.01, `the largest patch of skin, not the specks (${face.y})`)
})
