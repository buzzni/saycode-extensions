import assert from 'node:assert/strict'
import { test } from 'node:test'

import { textProblems } from '../lib/textcheck.mjs'

// 상자·얼굴·대상은 모두 화면 비율(0~1), 위에서부터 잰다.
const face = { x: 0.45, y: 0.3, w: 0.15, h: 0.08 }
const product = { x: 0.1, y: 0.2, w: 0.8, h: 0.6 }

test('a caption over more than 15% of a face is reported', () => {
  const over = textProblems({ box: { x: 0.4, y: 0.3, w: 0.3, h: 0.06 }, faces: [face], subjects: [] })
  assert.deepEqual(over.map((problem) => problem.kind), ['face'])
  assert.ok(over[0].share > 0.15)
  assert.deepEqual(textProblems({ box: { x: 0.1, y: 0.1, w: 0.3, h: 0.05 }, faces: [face], subjects: [] }), [])
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
