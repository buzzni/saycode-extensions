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
