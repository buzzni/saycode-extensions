import assert from 'node:assert/strict'
import { test } from 'node:test'

import { choosePlacement } from '../lib/placement.mjs'
import { textProblems } from '../lib/textcheck.mjs'

// 화면 위쪽 12% 에 놓인 훅 상자(위에서 잰 비율).
const hook = { x: 0.2, y: 0.1, w: 0.6, h: 0.08 }
const range = [0.08, 0.7]

test('a caption that covers nothing stays where it is', () => {
  assert.deepEqual(choosePlacement({ box: hook, faces: [], subjects: [], range }), { moved: false, box: hook, scale: 1 })
})

test('a caption over a face moves to the nearest spot that covers no face', () => {
  const face = { x: 0.4, y: 0.08, w: 0.2, h: 0.14 }
  const result = choosePlacement({ box: hook, faces: [face], subjects: [], range })
  assert.equal(result.moved, true)
  assert.deepEqual(textProblems({ box: result.box, faces: [face] }), [], `covers at most what render tolerates: ${JSON.stringify(result.box)}`)
  assert.ok(result.box.y - hook.y < 0.2, 'and moves only just past the face')
  assert.equal(result.scale, 1)
})

test('the centre stays inside the allowed range (subtitles and platform UI below it)', () => {
  const face = { x: 0.1, y: 0.05, w: 0.8, h: 0.6 }
  const result = choosePlacement({ box: hook, faces: [face], subjects: [], range })
  assert.ok(result.box.y + result.box.h / 2 <= range[1] + 1e-9)
  assert.ok(result.box.y + result.box.h / 2 >= range[0] - 1e-9)
})

test('when every height covers a face, it tries smaller text before settling for the least covering spot', () => {
  // 얼굴이 0.05 간격으로 줄지어 있다(군중) — 0.09 높이 상자는 어디서든 얼굴을 15% 넘게 가리고, 줄인 글자만 틈에 들어간다.
  const faces = Array.from({ length: 7 }, (_, row) => ({ x: 0.2, y: row * 0.13, w: 0.6, h: 0.08 }))
  const result = choosePlacement({ box: { ...hook, h: 0.09 }, faces, subjects: [], range })
  assert.equal(result.moved, true)
  assert.ok(result.scale < 1, `shrunk to fit a gap: ${JSON.stringify(result)}`)
  assert.deepEqual(textProblems({ box: result.box, faces }), [])
})

test('the main subject counts too, so a caption moves off the product', () => {
  const product = { x: 0.2, y: 0.05, w: 0.6, h: 0.3 }
  const result = choosePlacement({ box: hook, faces: [], subjects: [product], range })
  assert.equal(result.moved, true)
})

test('when there is room, the caption clears the face with a margin instead of stopping at what render tolerates', () => {
  // 얼굴 아래에 빈 자리가 충분하다 — 턱에 걸친 채(15% 이하) 멈추지 않고 얼굴 둘레까지 비운다.
  const face = { x: 0.4, y: 0.1, w: 0.2, h: 0.12 }
  const result = choosePlacement({ box: { x: 0.2, y: 0.17, w: 0.6, h: 0.08 }, faces: [face], subjects: [], range })
  assert.ok(result.box.y >= face.y + face.h, `below the chin: ${JSON.stringify(result.box)}`)
})
