// plan.json 검증기. 숏폼 규칙 중 숫자로 잴 수 있는 것만 강제한다 — 나머지(훅의 강도, 장면의 매력)는
// 기획 점검(시청자 점검 하위 에이전트)이 본다. 규칙의 근거는 references/workflow.md 에 있다.

import { posix } from 'node:path'

import { LTX_TAKE_SECONDS } from './backends/ltx.mjs'
import { MUSIC } from './assets.mjs'
import { LOOKS } from './looks.mjs'
import { SFX_KINDS } from './sfx.mjs'

const MAX_SHOT_SECONDS = 4
const SECONDS_PER_CUT = 3
const NARRATION_CHARS_PER_SECOND = 6
const TARGET_TOLERANCE = 0.2
// 30초 기준 8~12초 — 이탈이 가장 많은 구간. 이보다 이른 반전은 훅의 첫 보상이라 리훅을 대신하지 못한다.
const REHOOK_WINDOW = [0.25, 0.45]
// 영상 모델에 자막을 넣지 말라고 쓰면 오히려 가짜 글자를 그린다(LTX 실측 2026-11-21). 그런 단어 자체를 쓰지 않는다.
const TEXT_WORDS = /subtitle|caption|자막|on-screen text|\bno text\b/i
// 간판·포스터가 많은 장소. LTX 는 장면 속 글자를 그리면 한글이 깨진다(실측 2026-11-21) — 배경을 흐리게 찍으면 사라진다.
const SIGNAGE_PLACES = /convenience store|storefront|store front|\bshop\b|\bstation\b|\bsubway\b|\bmarket\b|\bmall\b|billboard|\bsigns?\b|signage|\bmenu\b|restaurant|\bcaf[eé]\b|downtown|\bneon\b|street stalls|편의점|간판|역 |상점|가게/i
const BLURRED_BACKGROUND = /shallow depth of field|\bbokeh\b|out of focus|blurred background|background (is )?(a )?soft(ly)? blur|defocused/i
const NUMBERS_IN_PROMPT = /(\d[\d,.]*\s*(원|만원|달러|%|퍼센트))|([₩$€]\s*\d)/
// 장면 id 는 파일 이름(takes/<id>.mp4, jobs/…)이 된다. 경로 문자를 막는다.
const MOMENT_ID = /^[A-Za-z0-9_-]{1,40}$/
const COLOR = /^(0x[0-9a-fA-F]{6}|[a-z]{3,20})$/
// 훅 메커니즘: 손실 회피, 정보 격차, 통념 반박, 구체적 상황·POV, 결과·증거 선공개. 후보는 서로 다른 메커니즘 3개 이상.
export const HOOK_MECHANISMS = ['loss', 'gap', 'hot_take', 'situation', 'proof']
// 플랫폼별 업계 권장 길이(초). 플랫폼 공식 기준이 아니라 경고만 한다.
const PLATFORM_SECONDS = { shorts: [15, 60], reels: [15, 90], tiktok: [15, 35] }
const ENDINGS = ['peak', 'loop', 'cta']
const CTAS = ['save', 'share', 'comment', 'follow', 'link']
// AI 대본 상투어: 인사·예고·나열 접속사. 0~3초에 스와이프를 부른다.
const SLOP = /안녕하세요|오늘은\s*[^ ]*\s*(에\s*대해|을|를)?\s*(알아보|소개|이야기)|알고\s*계셨나요|첫째|둘째|셋째|또한|따라서|뿐만\s*아니라|결론적으로|!!+/
// 사실 주장이 되는 숫자(비율·금액·배수·인원). 이야기 속 시각("10분 전")은 대상이 아니다.
const NUMBER = /\d[\d,.]*\s*(%|퍼센트|원|만\s*원|달러|배|명)/g
const HOOK_CAPTION_MAX = 16
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

  if (plan.look !== undefined && !Object.hasOwn(LOOKS, String(plan.look))) {
    error('look', `글자 디자인 묶음(look)은 ${Object.keys(LOOKS).join(', ')} 중 하나다 — shorts-director looks 로 본다.`)
  }
  if (plan.music?.track !== undefined) {
    if (!Object.hasOwn(MUSIC, String(plan.music.track))) error('music.track', '배경음 track 은 `shorts-director music` 목록의 id 다(CC0 곡만).')
  } else if (plan.music && !inMaterials(plan.music.file)) {
    error('music.file', '배경음 파일은 materials/ 에 둔다(사용 권리가 있는 음원만).')
  }

  for (const moment of plan.moments ?? []) {
    if (moment.caption?.emphasis && !String(moment.caption.text ?? '').includes(moment.caption.emphasis)) {
      warn('caption.emphasis', '강조어(caption.emphasis)는 그 문구 안에 있는 낱말이어야 색이 바뀐다.', moment.id)
    }
    if (Array.isArray(moment.sfx) && moment.sfx.some((sound) => !SFX_KINDS[sound?.kind])) {
      error('sfx.kind', `효과음은 ${Object.keys(SFX_KINDS).join(', ')} 중에서 고른다.`, moment.id)
    }
  }

  const options = plan.hook?.options
  if (!Array.isArray(options) || options.length < 3 || options.length > 4 || !options.every((option) => option?.line && option?.question)) {
    error('hook.options', '훅 후보는 3~4개이고, 각각 { line(첫 문장), mechanism, question(시청자 머릿속에 남는 단 하나의 질문) } 이다.')
  } else {
    const mechanisms = options.map((option) => option.mechanism)
    if (mechanisms.some((mechanism) => !HOOK_MECHANISMS.includes(mechanism)) || new Set(mechanisms).size < 3) {
      error('hook.mechanism', `훅 후보는 서로 다른 메커니즘 3개 이상으로 만든다(${HOOK_MECHANISMS.join(', ')}).`)
    }
    if (!Number.isInteger(plan.hook.chosen) || plan.hook.chosen < 0 || plan.hook.chosen >= options.length) {
      error('hook.chosen', '훅 후보 중 무엇을 골랐는지 hook.chosen 에 남긴다.')
    }
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

  checkStructure(plan, moments, total, error, warn)

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

// 0~3초 3중 훅, 8~12초 중반 리훅, 결말(정점·루프·단일 CTA), 플랫폼 길이, 상투어, 출처 없는 숫자, 자막 길이.
function checkStructure(plan, moments, total, error, warn) {
  const first = moments[0]
  const firstSpoken = (plan.narration ?? []).some((line) => line.moment === first.id || (line.moment === undefined && plan.narration[0] === line))
    || (first.dialogue ?? []).length > 0
  if (first.caption?.role !== 'hook' || !firstSpoken) {
    warn('hook.layers', '0~3초의 화면·말·자막이 같은 훅을 가리켜야 한다 — 첫 장면에 hook 자막과 첫 내레이션(또는 대사)을 둔다.', first.id)
  }

  if (total >= 15) {
    let cursor = 0
    const rehookAt = []
    for (const moment of moments) {
      if (moment.beat === 'rehook') rehookAt.push(cursor)
      cursor += Number(moment.seconds)
    }
    const [from, to] = REHOOK_WINDOW.map((ratio) => total * ratio)
    if (!rehookAt.some((start) => start >= from && start <= to)) {
      warn('pace.rehook', `중반 리훅(반전·예외·시각 전환)은 ${from.toFixed(1)}~${to.toFixed(1)}초(전체의 25~45%)에 시작하는 장면에 둔다(beat: "rehook"). 그보다 이른 반전은 훅의 첫 보상이고, 리훅은 따로 둔다.`)
    }
  }

  const ending = plan.ending
  if (ending !== undefined) {
    if (!ENDINGS.includes(ending.type)) error('ending.type', `ending.type 은 ${ENDINGS.join(' / ')} 중 하나다.`)
    else if (ending.type === 'cta' && !CTAS.includes(ending.cta)) {
      warn('ending.cta', `CTA 는 딱 하나만(${CTAS.join(' / ')}) — 여러 행동을 한꺼번에 요구하지 않는다.`)
    }
  }

  if (plan.platform !== undefined) {
    const range = PLATFORM_SECONDS[plan.platform]
    if (!range) error('platform', `platform 은 ${Object.keys(PLATFORM_SECONDS).join(' / ')} 중 하나다.`)
    else if (total < range[0] || total > range[1]) {
      warn('length.platform', `${plan.platform} 은 보통 ${range[0]}~${range[1]}초가 잘 된다(업계 권장) — 지금 ${total}초.`)
    }
  }

  const texts = [...(plan.narration ?? []).map((line) => line.text), ...moments.flatMap((moment) => [moment.caption?.text, ...(moment.subtitles ?? []).map((line) => line.text)])].filter(Boolean)
  if (texts.some((text) => SLOP.test(text))) {
    warn('script.slop', '인사·예고("안녕하세요", "오늘은 ~에 대해")·나열 접속사("첫째", "또한", "따라서")·느낌표 남발을 뺀다.')
  }
  const sourced = (plan.facts ?? []).map((fact) => String(fact.text ?? '')).join(' ')
  const unsourced = texts.flatMap((text) => text.match(NUMBER) ?? []).filter((number) => !sourced.includes(number.replace(/\s+/g, '').replace(/퍼센트/, '%')) && !sourced.includes(number))
  if (unsourced.length) {
    warn('claim.unsourced', `출처 없는 숫자: ${[...new Set(unsourced)].join(', ')} — 확인한 값은 plan.facts 에 { text, source } 로 적고, 아니면 뺀다.`)
  }

  for (const moment of moments) {
    if (moment.caption?.role === 'hook' && String(moment.caption.text).replace(/\s/g, '').length > HOOK_CAPTION_MAX) {
      warn('caption.length', `훅 자막은 2초 안에 읽혀야 한다 — ${HOOK_CAPTION_MAX}자 이하로 줄인다.`, moment.id)
    }
  }
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
  if (SIGNAGE_PLACES.test(prompt) && !BLURRED_BACKGROUND.test(prompt)) {
    warn('prompt.signage', '간판·포스터가 많은 장소다 — 장면 속 한글이 깨져 그려진다. "very shallow depth of field" 로 배경을 흐리게 하거나, 글자 없는 배경으로 가깝게 찍는다. 꼭 보여야 할 글자는 화면 문구로 얹는다.', moment.id)
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
