import assert from 'node:assert/strict'
import { test } from 'node:test'

import { postIssues, postMarkdown } from '../lib/post.mjs'

const codes = (issues) => issues.map((issue) => issue.code)

function plan(post, extra = {}) {
  return {
    title: '퇴근길 우산',
    platform: 'shorts',
    moments: [{ id: 'm1', seconds: 5 }, { id: 'm2', seconds: 5 }],
    post,
    ...extra,
  }
}

test('a plan without post copy has nothing to check', () => {
  assert.deepEqual(postIssues({ moments: [] }), [])
})

test('platform limits are errors: shorts title 100, more than 15 shorts tags, more than 5 reels tags, caption lengths', () => {
  const issues = postIssues(plan({
    shorts: { title: '가'.repeat(101), text: '설명', tags: Array.from({ length: 16 }, (_, index) => `t${index}`) },
    reels: { text: '가'.repeat(2201), tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
    tiktok: { text: '가'.repeat(4001), tags: ['a'] },
  }))
  const errors = issues.filter((issue) => issue.level === 'error').map((issue) => `${issue.code}@${issue.where}`)
  assert.deepEqual(errors.sort(), ['post.tags@reels', 'post.tags@shorts', 'post.text@reels', 'post.text@tiktok', 'post.title@shorts'].sort())
})

test('shorts needs a title, tags carry no spaces, unknown platforms are refused', () => {
  const issues = postIssues(plan({ shorts: { text: '설명', tags: ['퇴근 길'] }, threads: { text: 'x' } }))
  assert.deepEqual(codes(issues.filter((issue) => issue.level === 'error')).sort(), ['post.platform', 'post.tags', 'post.title'].sort())
})

test('editorial warnings: a long shorts title, a long first caption line, more than five tags, the planned platform missing', () => {
  const issues = postIssues(plan({
    shorts: { title: '가'.repeat(41), text: '설명', tags: ['a', 'b', 'c', 'd', 'e', 'f'] },
    tiktok: { text: `${'가'.repeat(41)}\n둘째 줄`, tags: ['a'] },
  }, { platform: 'reels' }))
  assert.ok(issues.every((issue) => issue.level === 'warning'), JSON.stringify(issues))
  assert.deepEqual(codes(issues).sort(), ['post.first_line', 'post.missing', 'post.tag_count', 'post.title_length'].sort())
})

test('a leading # on a tag is accepted and written once', () => {
  const copy = { shorts: { title: '우산 없이 나온 날', text: '비 오는 퇴근길.', tags: ['#퇴근길', '우산'] } }
  assert.deepEqual(postIssues(plan(copy)), [])
  assert.match(postMarkdown(plan(copy)), /#퇴근길 #우산/)
  assert.doesNotMatch(postMarkdown(plan(copy)), /##퇴근길/)
})

test('the cover frame must fall inside the video and its text stays inside the 3:4 profile grid', () => {
  const issues = postIssues(plan(undefined, { cover: { at: 12, text: '우산 없이 나온 날, 퇴근길이 이렇게 됩니다', emphasis: '버스', position: { y: 0.1 } } }))
  assert.deepEqual(codes(issues.filter((issue) => issue.level === 'error')), ['cover.at'])
  assert.deepEqual(codes(issues.filter((issue) => issue.level === 'warning')).sort(), ['cover.emphasis', 'cover.grid', 'cover.length'].sort())
  assert.deepEqual(codes(postIssues(plan(undefined, { cover: { at: 2 } }))), ['cover.text'])
})

test('the markdown lists every platform with its own copy and says nothing is posted', () => {
  const text = postMarkdown(plan({
    shorts: { title: '우산 없이 나온 날', text: '비 오는 퇴근길.', tags: ['퇴근길'] },
    reels: { text: '우산 없을 때 당신은?\n뛴다 vs 기다린다', tags: ['비오는날'] },
  }))
  assert.match(text, /# 올릴 글 — 퇴근길 우산/)
  assert.match(text, /게시하지 않는다/)
  assert.match(text, /## 유튜브 쇼츠[\s\S]*제목: 우산 없이 나온 날[\s\S]*#퇴근길/)
  assert.match(text, /## 인스타그램 릴스[\s\S]*뛴다 vs 기다린다[\s\S]*#비오는날/)
  assert.doesNotMatch(text, /틱톡/)
})
