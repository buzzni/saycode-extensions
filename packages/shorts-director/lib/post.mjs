// 올릴 글(plan.post)과 표지(plan.cover). 에이전트가 플랫폼마다 쓴 제목·설명·해시태그를 규칙에 맞는지 보고, 사람이 그대로
// 붙여 넣을 out/post.md 로 옮긴다. 게시는 하지 않는다 — 검수한 사람이 올린다.

// 한도(오류)는 각 플랫폼의 올리기 화면 기준(2026-11 확인): 유튜브 제목 100자·설명 5000자, 해시태그가 15개를 넘으면 유튜브가
// 모두 무시한다. 인스타그램 캡션 2200자, 해시태그는 2025-12 부터 게시물당 5개. 틱톡 캡션 4000자.
// 권장(경고)은 편집 기준이다: 쇼츠 피드는 제목을 약 40자에서 자르고, 릴스·틱톡은 캡션 첫 줄만 "더 보기" 앞에 보인다.
export const POST_RULES = {
  shorts: { name: '유튜브 쇼츠', title: true, titleMax: 100, titleShown: 40, textMax: 5000, tagsMax: 15 },
  reels: { name: '인스타그램 릴스', title: false, textMax: 2200, tagsMax: 5 },
  tiktok: { name: '틱톡', title: false, textMax: 4000 },
}
const TAGS_SUGGESTED = 5
const FIRST_LINE_SHOWN = 40
const COVER_TEXT_MAX = 16
// 인스타그램 프로필 격자는 9:16 표지의 가운데 3:4 만 보인다(위아래 약 12.5% 씩 잘림). 글자는 그 안에 둔다.
export const COVER_GRID = [0.2, 0.75]
export const COVER_Y = 0.3

export function postIssues(plan) {
  const issues = []
  const error = (code, message, where) => issues.push({ level: 'error', code, message, ...(where ? { where } : {}) })
  const warn = (code, message, where) => issues.push({ level: 'warning', code, message, ...(where ? { where } : {}) })

  const post = plan.post
  if (post !== undefined) {
    for (const [platform, copy] of Object.entries(post)) {
      const rules = POST_RULES[platform]
      if (!rules) {
        error('post.platform', `올릴 글의 플랫폼은 ${Object.keys(POST_RULES).join(' / ')} 중 하나다.`, platform)
        continue
      }
      checkCopy(platform, rules, copy ?? {}, error, warn)
    }
    if (plan.platform && POST_RULES[plan.platform] && !post[plan.platform]) {
      warn('post.missing', `주력 플랫폼(${plan.platform})의 올릴 글이 없다 — post.${plan.platform} 을 쓴다.`)
    }
  }

  const cover = plan.cover
  if (cover !== undefined) {
    const total = (plan.moments ?? []).reduce((sum, moment) => sum + Number(moment.seconds || 0), 0)
    const at = Number(cover.at)
    if (!(at >= 0 && at < total)) error('cover.at', `표지 프레임(cover.at)은 0~${total}초 안의 시각이다.`)
    const text = String(cover.text ?? '').trim()
    if (!text) error('cover.text', '표지 문구(cover.text)가 없다 — 피드·프로필에서 무슨 영상인지 보이게 짧게 쓴다.')
    else if (text.replace(/\s/g, '').length > COVER_TEXT_MAX) warn('cover.length', `표지 문구는 작은 격자에서도 읽혀야 한다 — ${COVER_TEXT_MAX}자 이하로 줄인다.`)
    if (cover.emphasis && !text.includes(cover.emphasis)) warn('cover.emphasis', '강조어(cover.emphasis)는 표지 문구 안에 있는 낱말이어야 색이 바뀐다.')
    const y = cover.position?.y
    if (y !== undefined) {
      if (!(Number(y) > 0 && Number(y) < 1)) error('cover.position', '표지 문구의 position.y 는 화면 위에서부터 0~1 사이(문구 중심)다.')
      else if (Number(y) < COVER_GRID[0] || Number(y) > COVER_GRID[1]) warn('cover.grid', `인스타그램 프로필 격자는 가운데 3:4 만 보인다 — 표지 문구는 y ${COVER_GRID[0]}~${COVER_GRID[1]} 에 둔다.`)
    }
  }
  return issues
}

function checkCopy(platform, rules, copy, error, warn) {
  if (rules.title) {
    const title = String(copy.title ?? '').trim()
    if (!title) error('post.title', `${rules.name}에는 제목(title)이 있어야 한다.`, platform)
    else if (title.length > rules.titleMax) error('post.title', `${rules.name} 제목은 ${rules.titleMax}자까지다 — 지금 ${title.length}자.`, platform)
    else if (title.length > rules.titleShown) warn('post.title_length', `${rules.name} 피드는 제목을 약 ${rules.titleShown}자에서 자른다 — 핵심을 앞에 두거나 줄인다.`, platform)
  }
  const text = String(copy.text ?? '')
  if (text.length > rules.textMax) error('post.text', `${rules.name} ${rules.title ? '설명' : '캡션'}은 ${rules.textMax}자까지다 — 지금 ${text.length}자.`, platform)
  if (!rules.title && text.split('\n')[0].trim().length > FIRST_LINE_SHOWN) {
    warn('post.first_line', `${rules.name}는 캡션 첫 줄만 "더 보기" 앞에 보인다 — 첫 줄을 ${FIRST_LINE_SHOWN}자 안쪽의 한마디로 쓴다.`, platform)
  }
  const tags = copy.tags ?? []
  if (!Array.isArray(tags) || tags.some((tag) => !normalTag(tag) || /\s/.test(normalTag(tag)))) {
    error('post.tags', '해시태그(tags)는 띄어쓰기 없는 낱말의 목록이다(# 은 붙여도 되고 빼도 된다).', platform)
  } else if (rules.tagsMax && tags.length > rules.tagsMax) {
    error('post.tags', `${rules.name} 해시태그는 ${rules.tagsMax}개까지다${platform === 'shorts' ? '(넘으면 유튜브가 모두 무시한다)' : ''} — 지금 ${tags.length}개.`, platform)
  } else if (tags.length > TAGS_SUGGESTED) {
    warn('post.tag_count', `해시태그는 주제에 맞는 ${TAGS_SUGGESTED}개 안쪽이 낫다 — 지금 ${tags.length}개.`, platform)
  }
}

function normalTag(tag) {
  return String(tag ?? '').trim().replace(/^#+/, '')
}

// 말·자막과 같은 사실 점검(출처 없는 숫자)을 받도록 올릴 글의 문장을 꺼낸다.
export function postTexts(plan) {
  return [
    ...Object.values(plan.post ?? {}).flatMap((copy) => [copy?.title, copy?.text]),
    plan.cover?.text,
  ].filter(Boolean).map(String)
}

export function postMarkdown(plan, { cover = 'out/cover.jpg' } = {}) {
  const lines = [`# 올릴 글 — ${plan.title ?? '숏폼'}`, '', '검수한 뒤 사람이 직접 올린다. 이 도구는 게시하지 않는다.', '']
  for (const [platform, rules] of Object.entries(POST_RULES)) {
    const copy = plan.post?.[platform]
    if (!copy) continue
    lines.push(`## ${rules.name}`, '')
    if (rules.title) lines.push(`제목: ${copy.title}`, '')
    if (copy.text) lines.push(rules.title ? '설명:' : '캡션:', String(copy.text), '')
    const tags = (copy.tags ?? []).map((tag) => `#${normalTag(tag)}`)
    if (tags.length) lines.push(tags.join(' '), '')
  }
  if (plan.cover) lines.push('## 표지', '', `${cover} — ${plan.cover.at}초 화면, 문구 "${plan.cover.text}". 릴스·틱톡은 올릴 때 표지로 고르고, 쇼츠는 앱에서 같은 시각의 프레임을 고른다.`, '')
  return lines.join('\n')
}
