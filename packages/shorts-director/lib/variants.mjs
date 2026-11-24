// 변형(plan.variants): 한 기획에서 글자·말만 바꾼 판. 테이크 요청은 그대로라 영상을 다시 만들지 않고, 내레이션의 바뀐 줄만
// 다시 읽고 render 만 다시 한다. 첫 문장이나 CTA 같은 한 가지만 바꿔, 올린 뒤 어느 쪽이 나은지 비교한다.

// 테이크를 다시 만들지 않고 바꿀 수 있는 장면 값. 그 밖의 값(장면 길이·프롬프트·컷·대사·소리·seed·from)은 테이크 요청이 바뀐다.
const WORD_FIELDS = new Set(['caption', 'asides', 'subtitles'])
const CARD_FIELDS = new Set([...WORD_FIELDS, 'background'])
// 파일 이름(out/final-<id>.mp4, audio/variants/<id>/)이 된다.
const VARIANT_ID = /^[a-z0-9][a-z0-9-]{0,19}$/
const RESERVED = new Set(['final', 'draft', 'base'])

export function variantIssues(plan) {
  const issues = []
  const error = (code, message, where) => issues.push({ level: 'error', code, message, where })
  const warn = (code, message, where) => issues.push({ level: 'warning', code, message, where })
  const moments = new Map((plan.moments ?? []).map((moment) => [moment.id, moment]))
  const narration = plan.narration ?? []
  const seen = new Set()

  for (const variant of plan.variants ?? []) {
    const id = String(variant?.id ?? '')
    const where = `variant ${id || '?'}`
    if (!VARIANT_ID.test(id) || RESERVED.has(id) || seen.has(id)) {
      error('variant.id', `변형 id 는 겹치지 않는 영문 소문자·숫자·-, 20자 이하다(${[...RESERVED].join('·')} 제외).`, where)
    }
    seen.add(id)
    if (!String(variant?.hypothesis ?? '').trim()) {
      error('variant.hypothesis', '무엇이 무엇보다 나을지 한 문장으로 hypothesis 에 적는다 — 올린 뒤 무엇을 비교할지 정해 둔다.', where)
    }
    const overrides = Object.entries(variant?.moments ?? {})
    const lines = Object.entries(variant?.narration ?? {})
    if (overrides.length + lines.length === 0 && !variant?.post && !variant?.cover) {
      error('variant.change', '바꾼 것이 없다 — moments(문구), narration(줄 번호: 새 문장), post, cover 중 하나를 바꾼다.', where)
    }
    const touched = new Set()
    for (const [momentId, fields] of overrides) {
      const moment = moments.get(momentId)
      if (!moment) {
        error('variant.moment', `기획에 없는 장면 ${momentId}.`, where)
        continue
      }
      touched.add(momentId)
      const allowed = moment.kind === 'card' ? CARD_FIELDS : WORD_FIELDS
      const blocked = Object.keys(fields ?? {}).filter((field) => !allowed.has(field))
      if (blocked.length) {
        error('variant.take_field', `${momentId} 의 ${blocked.join(', ')} 은(는) 변형에서 바꿀 수 없다 — 변형은 화면 문구(${[...allowed].join(', ')})와 내레이션만 바꾼다. 영상이 달라야 하면 기획을 바꾼다.`, where)
      }
    }
    for (const [index, text] of lines) {
      const position = Number(index)
      if (!Number.isInteger(position) || position < 0 || position >= narration.length || !String(text ?? '').trim()) {
        error('variant.narration', `narration 은 { "줄 번호(0부터)": "새 문장" } 이다 — 기획의 내레이션은 ${narration.length}줄이다.`, where)
        continue
      }
      touched.add(lineScene(plan, position))
    }
    if (touched.size > 1) {
      warn('variant.scope', `${[...touched].join(', ')} 장면을 함께 바꿨다 — 변형은 한 가지(첫 장면이나 마지막 장면)만 바꿔야 올린 뒤 무엇 때문에 달랐는지 안다.`, where)
    }
    if (variant?.hook !== undefined && variant.hook === plan.hook?.chosen) {
      warn('variant.hook', '이 변형의 hook 이 기획이 고른 훅과 같다 — 탈락한 후보를 고른다.', where)
    }
  }
  return issues
}

// 줄이 속한 장면: 적힌 moment, 없으면 앞 줄의 장면, 그것도 없으면 첫 장면.
function lineScene(plan, position) {
  for (let index = position; index >= 0; index -= 1) {
    const moment = plan.narration[index]?.moment
    if (moment) return moment
  }
  return plan.moments?.[0]?.id
}

// 기획에 변형을 덮어쓴 판을 만든다. 변형 목록은 빼서, 합친 판을 다시 검증해도 변형을 또 펼치지 않는다.
export function applyVariant(plan, id) {
  const variant = (plan.variants ?? []).find((item) => item.id === id)
  if (!variant) throw new Error(`plan.variants 에 ${id} 가 없다`)
  const { variants, ...rest } = structuredClone(plan)
  const merged = rest
  for (const [momentId, fields] of Object.entries(variant.moments ?? {})) {
    const moment = merged.moments.find((item) => item.id === momentId)
    if (!moment) continue
    for (const [field, value] of Object.entries(fields ?? {})) {
      if (value === null) delete moment[field]
      else moment[field] = structuredClone(value)
    }
  }
  for (const [index, text] of Object.entries(variant.narration ?? {})) {
    if (merged.narration?.[Number(index)]) merged.narration[Number(index)].text = String(text)
  }
  if (variant.hook !== undefined && merged.hook) merged.hook.chosen = variant.hook
  if (variant.post) merged.post = { ...merged.post, ...structuredClone(variant.post) }
  if (variant.cover) merged.cover = structuredClone(variant.cover)
  return merged
}
