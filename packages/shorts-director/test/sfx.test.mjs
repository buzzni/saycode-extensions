import assert from 'node:assert/strict'
import { test } from 'node:test'

import { SFX_KINDS, sfxEvents } from '../lib/sfx.mjs'

function plan(moments, extra = {}) {
  return { moments, ...extra }
}

test('sounds land on screen events: the hook pops, cuts whoosh, the re-hook thuds, a title pops', () => {
  const events = sfxEvents(plan([
    { id: 'm1', kind: 'take', seconds: 4, caption: { text: '훅', role: 'hook' } },
    { id: 'm2', kind: 'take', seconds: 3 },
    { id: 'm3', kind: 'photo', seconds: 3, beat: 'rehook' },
    { id: 'm4', kind: 'card', seconds: 3, caption: { text: '정보', role: 'info' } },
  ]))
  assert.deepEqual(events, [
    { kind: 'pop', at: 0 },
    { kind: 'whoosh', at: 3.8 },
    { kind: 'thud', at: 7 },
    { kind: 'pop', at: 10 },
  ])
})

test('a take chained from the one before is one continuous shot, so its start gets no whoosh', () => {
  const events = sfxEvents(plan([
    { id: 'm1', kind: 'take', seconds: 4 },
    { id: 'm2', kind: 'take', seconds: 4, from: { take: 'm1' } },
  ]))
  assert.deepEqual(events, [])
})

test('two sounds never land within 0.6 seconds: the stronger one wins', () => {
  const events = sfxEvents(plan([
    { id: 'm1', kind: 'take', seconds: 4 },
    { id: 'm2', kind: 'take', seconds: 3, caption: { text: '제목', role: 'title' } },
  ]))
  assert.deepEqual(events, [{ kind: 'pop', at: 4 }])
})

test('a plan can add sounds, silence a moment, or turn sounds off, and a short keeps at most eight', () => {
  const explicit = sfxEvents(plan([
    { id: 'm1', kind: 'take', seconds: 4, sfx: [{ kind: 'click', at: 2.5 }] },
    { id: 'm2', kind: 'take', seconds: 3, sfx: false },
  ]))
  assert.deepEqual(explicit, [{ kind: 'click', at: 2.5 }])

  assert.deepEqual(sfxEvents(plan([{ id: 'm1', kind: 'take', seconds: 4, caption: { text: '훅', role: 'hook' } }], { sfx: false })), [])

  const many = sfxEvents(plan(Array.from({ length: 12 }, (_, index) => ({ id: `m${index}`, kind: 'take', seconds: 2 }))))
  assert.equal(many.length, 8)
})

test('every kind of sound is synthesized by ffmpeg at render time, so no audio file ships with the package', () => {
  assert.deepEqual(Object.keys(SFX_KINDS).sort(), ['click', 'pop', 'thud', 'whoosh'])
  for (const source of Object.values(SFX_KINDS)) assert.match(source, /^(aevalsrc|anoisesrc)=/)
})
