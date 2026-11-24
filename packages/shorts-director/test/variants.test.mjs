import assert from 'node:assert/strict'
import { test } from 'node:test'

import { validatePlan } from '../lib/plan.mjs'
import { buildTake } from '../lib/takes.mjs'
import { applyVariant, variantIssues } from '../lib/variants.mjs'

const CONFIG = { video: { width: 576, height: 1024, fps: 24 } }

function shots(count, seconds) {
  return Array.from({ length: count }, (_, index) => ({ seconds, framing: `f${index}`, action: 'a' }))
}

function plan(variants) {
  return {
    version: 1,
    title: '퇴근길 우산',
    target_seconds: 15,
    platform: 'shorts',
    hook: {
      options: [
        { line: '우산 없이 나오면 매일 손해 보는 이유', mechanism: 'loss', question: '무슨 손해지?' },
        { line: '퇴근 10분 전, 하필 비가 쏟아졌다', mechanism: 'situation', question: '그래서 어떻게 됐지?' },
        { line: '편의점 우산이 다 팔린 날 생긴 일', mechanism: 'gap', question: '무슨 일이 생겼지?' },
      ],
      chosen: 1,
    },
    ending: { type: 'cta', cta: 'comment', text: '뛴다 vs 기다린다' },
    subjects: [{ id: 'hero', kind: 'person', look: 'Korean office worker in her 30s, beige trench coat' }],
    moments: [
      { id: 'm1', kind: 'take', place: 'subway exit', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p1', caption: { text: '퇴근 10분 전 폭우', role: 'hook' } },
      { id: 'm2', kind: 'take', place: 'stairs', seconds: 5, subjects: ['hero'], shots: shots(2, 2.5), video_prompt: 'p2', beat: 'rehook' },
      { id: 'm3', kind: 'card', seconds: 5, shots: shots(2, 2.5), caption: { text: '뛴다 vs 기다린다', role: 'info' } },
    ],
    narration: [
      { text: '퇴근 십 분 전, 하필 비가 쏟아졌어요.', moment: 'm1' },
      { text: '계단 끝에서 멈췄죠.', moment: 'm2' },
      { text: '당신은 뛴다, 기다린다?', moment: 'm3' },
    ],
    ...(variants ? { variants } : {}),
  }
}

const hookVariant = {
  id: 'b',
  hypothesis: '손실형 첫 문장이 상황형보다 3초 안에 덜 넘긴다',
  hook: 0,
  moments: { m1: { caption: { text: '우산 없으면 손해', role: 'hook', emphasis: '손해' } } },
  narration: { 0: '우산 없이 나오면 매일 손해 보는 이유가 있어요.' },
}

const codes = (issues) => issues.map((issue) => issue.code)

test('a variant changes only words: captions, narration lines and the chosen hook', () => {
  const merged = applyVariant(plan([hookVariant]), 'b')
  assert.equal(merged.moments[0].caption.text, '우산 없으면 손해')
  assert.equal(merged.narration[0].text, '우산 없이 나오면 매일 손해 보는 이유가 있어요.')
  assert.equal(merged.narration[0].moment, 'm1', 'the line keeps its scene')
  assert.equal(merged.narration[1].text, '계단 끝에서 멈췄죠.')
  assert.equal(merged.hook.chosen, 0)
  assert.equal(merged.variants, undefined)
})

test('a variant reuses every take: the take requests stay identical', () => {
  const base = plan([hookVariant])
  const merged = applyVariant(base, 'b')
  for (const index of [0, 1]) assert.deepEqual(buildTake(merged.moments[index], merged, CONFIG), buildTake(base.moments[index], base, CONFIG))
})

test('a variant may replace the post copy and the cover', () => {
  const base = plan([{ ...hookVariant, post: { shorts: { title: '우산 없으면 손해', tags: ['우산'] } }, cover: { at: 1, text: '우산 없으면 손해' } }])
  base.post = { shorts: { title: '퇴근 10분 전 폭우', tags: ['퇴근길'] }, reels: { text: '뛴다 vs 기다린다' } }
  const merged = applyVariant(base, 'b')
  assert.equal(merged.post.shorts.title, '우산 없으면 손해')
  assert.equal(merged.post.reels.text, '뛴다 vs 기다린다', 'platforms the variant leaves alone stay')
  assert.equal(merged.cover.text, '우산 없으면 손해')
})

test('a well-formed variant has no issues', () => {
  assert.deepEqual(variantIssues(plan([hookVariant])), [])
  assert.deepEqual(validatePlan(plan([hookVariant])).issues, [])
})

test('a variant cannot touch anything that would need a new take', () => {
  const issues = variantIssues(plan([{ ...hookVariant, moments: { m1: { video_prompt: 'p9', seconds: 4 } } }]))
  assert.deepEqual(codes(issues), ['variant.take_field'])
  assert.equal(issues[0].level, 'error')
})

test('a variant needs an id, a hypothesis and a change, and points at real scenes and lines', () => {
  const issues = variantIssues(plan([
    { id: 'final', hypothesis: 'x', narration: { 0: 'a' } },
    { id: 'c', moments: { m1: { caption: { text: '다른 훅', role: 'hook' } } } },
    { id: 'd', hypothesis: 'x' },
    { id: 'e', hypothesis: 'x', moments: { m9: { caption: { text: 'a' } } }, narration: { 7: 'a' } },
    { id: 'e', hypothesis: 'x', narration: { 0: 'b' } },
  ]))
  assert.deepEqual(codes(issues.filter((issue) => issue.level === 'error')).sort(), ['variant.change', 'variant.hypothesis', 'variant.id', 'variant.id', 'variant.moment', 'variant.narration'].sort())
})

test('changing more than one scene, or re-testing the chosen hook, is a warning', () => {
  const wide = { ...hookVariant, moments: { ...hookVariant.moments, m3: { caption: { text: '저장해 두세요', role: 'info' } } } }
  assert.deepEqual(codes(variantIssues(plan([wide]))), ['variant.scope'])
  assert.deepEqual(codes(variantIssues(plan([{ ...hookVariant, hook: 1 }]))), ['variant.hook'])
})

test('the merged variant is checked like a plan, and only what differs from the base is reported', () => {
  const longHook = { ...hookVariant, moments: { m1: { caption: { text: '우산 없이 나오면 퇴근길마다 매일 손해 보는 이유', role: 'hook' } } } }
  const issues = validatePlan(plan([longHook])).issues
  assert.deepEqual(issues.map((issue) => `${issue.code}@${issue.where}`), ['caption.length@b/m1'])
})
