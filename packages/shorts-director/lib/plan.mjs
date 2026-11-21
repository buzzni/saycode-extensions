// plan.json 검증기. 숏폼 규칙 중 숫자로 잴 수 있는 것만 강제한다 — 나머지(훅의 강도, 장면의 매력)는
// 기획 점검(시청자 점검 하위 에이전트)이 본다. 규칙의 근거는 references/workflow.md 에 있다.

import { posix } from 'node:path'

import { LTX_TAKE_SECONDS } from './backends/ltx.mjs'

const MAX_SHOT_SECONDS = 4
const SECONDS_PER_CUT = 3
const NARRATION_CHARS_PER_SECOND = 6
const TARGET_TOLERANCE = 0.2
// 영상 모델에 자막을 넣지 말라고 쓰면 오히려 가짜 글자를 그린다(LTX 실측 2026-11-21). 그런 단어 자체를 쓰지 않는다.
const TEXT_WORDS = /subtitle|caption|자막|on-screen text|\bno text\b/i
const NUMBERS_IN_PROMPT = /(\d[\d,.]*\s*(원|만원|달러|%|퍼센트))|([₩$€]\s*\d)/
// 장면 id 는 파일 이름(takes/<id>.mp4, jobs/…)이 된다. 경로 문자를 막는다.
const MOMENT_ID = /^[A-Za-z0-9_-]{1,40}$/
const COLOR = /^(0x[0-9a-fA-F]{6}|[a-z]{3,20})$/
const TAIL_ENDING = /구독|좋아요|팔로우|알림\s*설정|subscribe|like and/i

export function planSeconds(plan) {
  return round((plan.moments ?? []).reduce((sum, moment) => sum + Number(moment.seconds || 0), 0))
}

export function countTakes(plan) {
  return (plan.moments ?? []).filter((moment) => moment.kind === 'take').length
}

export function validatePlan(plan, { take = LTX_TAKE_SECONDS } = {}) {
  const issues = []
  const error = (code, message, where) => issues.push({ level: 'error', code, message, ...(where ? { where } : {}) })
  const warn = (code, message, where) => issues.push({ level: 'warning', code, message, ...(where ? { where } : {}) })

  const options = plan.hook?.options
  if (!Array.isArray(options) || options.length < 3 || options.length > 4) {
    error('hook.options', '훅 질문은 실제 첫 문장 후보 3~4개를 보여 줘야 한다.')
  } else if (!Number.isInteger(plan.hook.chosen) || plan.hook.chosen < 0 || plan.hook.chosen >= options.length) {
    error('hook.chosen', '훅 후보 중 무엇을 골랐는지 hook.chosen 에 남긴다.')
  }

  const moments = plan.moments ?? []
  if (moments.length === 0) {
    error('moments.empty', '장면이 없다.')
    return { ok: false, issues }
  }
  if (moments[0].kind === 'card') {
    error('opening.card', '글자 카드로 시작하지 않는다 — 사건이 이미 벌어지는 장면으로 시작한다.', moments[0].id)
  }

  const subjects = new Map((plan.subjects ?? []).map((subject) => [subject.id, subject]))
  const earlierTakes = new Set()
  let cuts = 0
  for (const moment of moments) {
    if (!MOMENT_ID.test(String(moment.id ?? ''))) error('moment.id', '장면 id 는 영문·숫자·_·- 만, 40자 이하.', String(moment.id))
    const shots = moment.shots ?? []
    cuts += shots.length
    for (const shot of shots) {
      if (Number(shot.seconds) > MAX_SHOT_SECONDS) {
        error('pace.shot', `한 컷이 ${shot.seconds}초다 — 컷은 1~3초, 길어도 ${MAX_SHOT_SECONDS}초.`, moment.id)
      }
    }
    const shotSum = round(shots.reduce((sum, shot) => sum + Number(shot.seconds || 0), 0))
    if (Math.abs(shotSum - Number(moment.seconds)) > 0.25) {
      error(moment.kind === 'take' ? 'take.shots_sum' : 'moment.shots_sum', `컷 합(${shotSum}초)이 장면 길이(${moment.seconds}초)와 다르다.`, moment.id)
    }
    for (const id of moment.subjects ?? []) {
      if (!subjects.has(id)) error('subject.unknown', `등록되지 않은 대상 ${id}.`, moment.id)
    }
    if (moment.kind === 'take') {
      checkTake(moment, take, error, warn)
      checkFrom(moment, earlierTakes, error, warn)
      earlierTakes.add(moment.id)
    }
    if (moment.kind === 'card' && moment.background !== undefined && !COLOR.test(String(moment.background))) {
      error('card.background', '배경색은 0xRRGGBB 또는 색 이름(black 등)만 쓴다.', moment.id)
    }
    if (moment.kind === 'photo' && !inMaterials(moment.file)) {
      error('photo.real', '카메라 무브(줌·팬)는 materials/ 의 실물 사진에만 쓴다 — 생성 이미지로 시간을 채우면 슬라이드쇼가 된다.', moment.id)
    }
  }

  const total = planSeconds(plan)
  if (cuts < Math.ceil(total / SECONDS_PER_CUT)) {
    error('pace.cuts', `${total}초에 컷이 ${cuts}개다 — ${SECONDS_PER_CUT}초마다 화면이 바뀌어야 한다(최소 ${Math.ceil(total / SECONDS_PER_CUT)}개).`)
  }
  const target = Number(plan.target_seconds)
  if (target > 0 && Math.abs(total - target) > target * TARGET_TOLERANCE) {
    error('length.target', `전체 ${total}초가 목표 ${target}초에서 ${Math.round(TARGET_TOLERANCE * 100)}% 넘게 벗어났다.`)
  }

  const narrationChars = (plan.narration ?? []).reduce((sum, line) => sum + String(line.text ?? '').replace(/\s/g, '').length, 0)
  const narrationBudget = Math.round(total * NARRATION_CHARS_PER_SECOND)
  if (narrationChars > narrationBudget * 1.1) {
    warn('narration.length', `내레이션 ${narrationChars}자 — ${total}초에 담기는 양(약 ${narrationBudget}자)을 넘는다. TTS 실측 뒤 줄인다.`)
  }

  const last = moments.at(-1)
  const tailTexts = [last.caption?.text, (plan.narration ?? []).at(-1)?.text].filter(Boolean)
  if (tailTexts.some((text) => TAIL_ENDING.test(text))) {
    warn('ending.tail', '구독·좋아요 요청으로 마무리하지 않는다 — 감정이 가장 높은 지점에서 자른다.', last.id)
  }

  return { ok: !issues.some((issue) => issue.level === 'error'), issues }
}

function checkTake(moment, limits, error, warn) {
  const seconds = Number(moment.seconds)
  if (!(seconds >= limits.min && seconds <= limits.max)) {
    error('take.seconds', `테이크는 한 번 생성에 ${limits.min}~${limits.max}초다.`, moment.id)
  }
  if (!moment.place) error('take.place', '한 테이크는 같은 순간·같은 장소만 묶는다 — place 를 적는다.', moment.id)
  if (!moment.video_prompt) error('take.video_prompt', '영상 프롬프트가 없다.', moment.id)
  const prompt = [moment.video_prompt, moment.sound, ...(moment.shots ?? []).map((shot) => `${shot.framing} ${shot.action}`)].join(' ')
  if (TEXT_WORDS.test(prompt)) {
    error('prompt.text_words', '영상 프롬프트에 자막·캡션·글자 이야기를 쓰지 않는다 — "넣지 말라"고 써도 가짜 글자를 그린다. 글자는 화면 문구로 얹는다.', moment.id)
  }
  if (NUMBERS_IN_PROMPT.test(prompt)) {
    warn('prompt.numbers', '가격·수치는 영상 모델이 틀리게 그린다 — 자막 오버레이로 옮긴다.', moment.id)
  }
}

// LTX 의 이미지 입력은 그 프레임을 고정할 뿐 얼굴을 다른 장면으로 옮겨 주지 않는다(실측 2026-11-21).
// 앞 테이크의 마지막 프레임에서 이어 찍으면 같은 인물이 유지되지만, 테이크 안에서 하드 컷을 하면 새 얼굴이 나온다.
function checkFrom(moment, earlierTakes, error, warn) {
  const from = moment.from
  if (!from) return
  if (from.take && !earlierTakes.has(from.take)) {
    error('take.from', `${from.take} 는 이 장면보다 앞의 테이크여야 한다.`, moment.id)
  } else if (!from.take && !inMaterials(from.file)) {
    error('take.from', '시작 사진은 materials/ 의 실제 사진이어야 한다.', moment.id)
  }
  if ((moment.shots ?? []).some((shot, index) => index > 0 && shot.transition === 'cut')) {
    warn('take.cut_after_anchor', '이어 찍는 테이크 안에서 하드 컷을 하면 얼굴이 바뀐다 — 카메라 이동(transition: move)으로 바꾼다.', moment.id)
  }
}

function inMaterials(file) {
  const normalized = posix.normalize(String(file ?? ''))
  return normalized.startsWith('materials/') && !normalized.split('/').includes('..')
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
