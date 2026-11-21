// plan.json 검증기. 숏폼 규칙 중 숫자로 잴 수 있는 것만 강제한다 — 나머지(훅의 강도, 장면의 매력)는
// 기획 점검(시청자 점검 하위 에이전트)이 본다. 규칙의 근거는 references/workflow.md 에 있다.

export const TAKE_SECONDS = { min: 3, max: 15 }
const MAX_SHOT_SECONDS = 4
const SECONDS_PER_CUT = 3
const NARRATION_CHARS_PER_SECOND = 6
const TARGET_TOLERANCE = 0.2
const CONTROL_TAG = /<(IMAGE_REF_\d+|VIDEO_REF_\d+|FIRST_FRAME|LAST_FRAME)>/
const NUMBERS_IN_PROMPT = /(\d[\d,.]*\s*(원|만원|달러|%|퍼센트))|([₩$€]\s*\d)/
const TAIL_ENDING = /구독|좋아요|팔로우|알림\s*설정|subscribe|like and/i

export function planSeconds(plan) {
  return round((plan.moments ?? []).reduce((sum, moment) => sum + Number(moment.seconds || 0), 0))
}

export function countTakes(plan) {
  return (plan.moments ?? []).filter((moment) => moment.kind === 'take').length
}

export function validatePlan(plan) {
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
  let cuts = 0
  for (const moment of moments) {
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
    if (moment.kind === 'take') checkTake(moment, subjects, error, warn)
    if (moment.kind === 'photo' && !String(moment.file ?? '').startsWith('materials/')) {
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

function checkTake(moment, subjects, error, warn) {
  const seconds = Number(moment.seconds)
  if (!Number.isInteger(seconds) || seconds < TAKE_SECONDS.min || seconds > TAKE_SECONDS.max) {
    error('take.seconds', `테이크는 ${TAKE_SECONDS.min}~${TAKE_SECONDS.max}초 정수다.`, moment.id)
  }
  if (!moment.place) error('take.place', '한 테이크는 같은 순간·같은 장소만 묶는다 — place 를 적는다.', moment.id)
  if (!moment.video_prompt) error('take.video_prompt', '영상 프롬프트가 없다.', moment.id)
  const hasPerson = (moment.subjects ?? []).some((id) => subjects.get(id)?.kind === 'person')
  if (hasPerson && !moment.first_frame) {
    error('take.first_frame', '인물 테이크는 캐릭터 시트로 그린 첫 프레임에서 시작한다(정체성 유지).', moment.id)
  }
  const prompt = String(moment.video_prompt ?? '')
  if (CONTROL_TAG.test(prompt)) {
    error('prompt.control_tag', '<IMAGE_REF_n> 같은 제어 태그는 폐기됐다 — 이미지 역할은 자연어로 쓴다.', moment.id)
  }
  if (NUMBERS_IN_PROMPT.test(prompt)) {
    warn('prompt.numbers', '가격·수치는 영상 모델이 틀리게 그린다 — 자막 오버레이로 옮긴다.', moment.id)
  }
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
