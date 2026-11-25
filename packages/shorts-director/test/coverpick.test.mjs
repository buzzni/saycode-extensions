import assert from 'node:assert/strict'
import { test } from 'node:test'

import { pickCoverMoments } from '../lib/coverPick.mjs'

const face = (size) => ({ x: 0.4, y: 0.2, w: size, h: size })

test('a big, sharp face ranks first, and picks stay apart in time', () => {
  const samples = [
    { at: 1, faces: [face(0.1)], subjects: [], blur: 2 },
    { at: 1.5, faces: [face(0.3)], subjects: [], blur: 2 },
    { at: 2, faces: [face(0.3)], subjects: [], blur: 2 },
    { at: 6, faces: [face(0.2)], subjects: [], blur: 2 },
    { at: 12, faces: [], subjects: [{ x: 0.2, y: 0.3, w: 0.5, h: 0.4 }], blur: 2 },
  ]
  const picks = pickCoverMoments(samples, { count: 3, minGap: 2 })
  assert.deepEqual(picks.map((pick) => pick.at), [1.5, 6, 12])
  assert.deepEqual(picks.map((pick) => pick.kind), ['face', 'face', 'subject'])
})

test('a blurred frame loses to a sharp one of the same size', () => {
  const samples = [{ at: 1, faces: [face(0.3)], subjects: [], blur: 9 }, { at: 5, faces: [face(0.3)], subjects: [], blur: 1 }]
  assert.equal(pickCoverMoments(samples, { count: 1 })[0].at, 5)
})

test('frames right at a cut and frames with nothing to show are never offered', () => {
  const samples = [
    { at: 4, faces: [face(0.4)], subjects: [], blur: 1 },
    { at: 8, faces: [], subjects: [], blur: 1 },
    { at: 10, faces: [face(0.15)], subjects: [], blur: 1 },
    { at: 14, faces: [face(0.05)], subjects: [], blur: 1 },
  ]
  assert.deepEqual(pickCoverMoments(samples, { count: 3, cuts: [4.1] }).map((pick) => pick.at), [10])
})

test('a face beats an object even when the object box is huge, and a whole-frame object box counts as little', () => {
  const samples = [
    { at: 3, faces: [face(0.12)], subjects: [{ x: 0, y: 0, w: 0.9, h: 0.9 }], blur: 2 },
    { at: 9, faces: [], subjects: [{ x: 0, y: 0.05, w: 0.95, h: 0.9 }], blur: 1 },
    { at: 15, faces: [], subjects: [{ x: 0.2, y: 0.3, w: 0.6, h: 0.5 }], blur: 1 },
  ]
  assert.deepEqual(pickCoverMoments(samples, { count: 2 }).map((pick) => pick.at), [3, 15])
})
