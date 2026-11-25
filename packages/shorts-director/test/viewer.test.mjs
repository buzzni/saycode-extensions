import assert from 'node:assert/strict'
import { test } from 'node:test'

import { viewerScript } from '../lib/viewer.mjs'

const plan = {
  title: '퇴근길 우산',
  moments: [
    {
      id: 'm1', kind: 'take', seconds: 4,
      shots: [{ seconds: 2, framing: 'wide shot', action: 'she stops at the top of the stairs' }, { seconds: 2, framing: 'close-up', action: 'her face falls' }],
      dialogue: [{ speaker: 'She', text: '아 진짜…' }],
      caption: { text: '우산 없이 나온 날', role: 'hook' },
      asides: [{ text: '(당황)', at: 2.5 }],
    },
    { id: 'm2', kind: 'photo', file: 'materials/umbrella.jpg', seconds: 3, shots: [{ seconds: 3, framing: 'photo', action: 'slow push in' }] },
    { id: 'm3', kind: 'card', seconds: 2, shots: [{ seconds: 2, framing: 'card', action: 'text' }], caption: { text: '오늘 밤 비 90%', role: 'info' } },
  ],
}
const narration = [{ text: '퇴근 십 분 전, 하필 비가 쏟아졌어요.', start: 0.2, end: 2.9 }, { text: '편의점 우산도 없었죠.', start: 4.1, end: 6.0 }]

test('the viewer script lists, shot by shot, the picture, the words on screen and what is heard', () => {
  const text = viewerScript(plan, narration, { sheet: 'out/contact.png', every: 1.5 })
  assert.match(text, /# 시청자에게 닿는 것 — 퇴근길 우산/)
  assert.match(text, /out\/contact\.png.*1\.5초/)
  const rows = text.split('\n').filter((line) => line.startsWith('| ') && !line.startsWith('| 시각') && !line.startsWith('|---'))
  assert.equal(rows.length, 4, 'one row per shot')
  assert.match(rows[0], /^\| 0–2초 \| wide shot: she stops at the top of the stairs \| 우산 없이 나온 날 \| 퇴근 십 분 전, 하필 비가 쏟아졌어요\. · She: "아 진짜…" \|/)
  assert.match(rows[1], /^\| 2–4초 \| close-up: her face falls \| 우산 없이 나온 날 · \(당황\) \| — \|/, 'the hook stays for its first three seconds and the aside shows up')
  assert.match(rows[2], /^\| 4–7초 \| 사진 materials\/umbrella\.jpg: slow push in \| — \| 편의점 우산도 없었죠\. \|/)
  assert.match(rows[3], /^\| 7–9초 \| 글자 카드 \| 오늘 밤 비 90% \| — \|/)
})

test('a line that runs on past its shot is listed where it starts, once', () => {
  const text = viewerScript(plan, [{ text: '길게 이어지는 한 줄', start: 1.5, end: 5 }])
  assert.equal(text.match(/길게 이어지는 한 줄/g).length, 1)
})
