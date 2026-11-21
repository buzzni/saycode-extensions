// plan.json 의 테이크 장면 → LTX 요청. LTX 는 한 문단의 서술을 잘 따르고, 문단 안의 "Hard cut to" 로 컷을 나눈다.
// 이미지 입력이 없어 인물 일관성은 같은 외형 묘사를 매 테이크에 그대로 넣는 것으로 지킨다.
import { createHash } from 'node:crypto'

export function buildTake(moment, plan, config) {
  const subjects = new Map((plan.subjects ?? []).map((subject) => [subject.id, subject]))
  const looks = (moment.subjects ?? []).map((id) => subjects.get(id)).filter((subject) => subject?.look)
  const sentences = [
    sentence(moment.video_prompt),
    ...looks.map((subject) => sentence(`The same ${subject.kind === 'person' ? 'person' : subject.kind ?? 'subject'} throughout: ${subject.look}`)),
    ...(moment.shots ?? []).map((shot, index) => sentence(index === 0 ? capitalize(`${shot.framing}: ${shot.action}`) : `Hard cut to ${shot.framing}: ${shot.action}`)),
    ...(moment.dialogue ?? []).map((line) => `${line.speaker} says in Korean, "${line.text}"`),
    sentence(moment.sound),
  ].filter(Boolean)

  return {
    momentId: moment.id,
    prompt: sentences.join(' '),
    seconds: Number(moment.seconds),
    width: config.video.width,
    height: config.video.height,
    fps: config.video.fps,
    seed: Number.isInteger(moment.seed) ? moment.seed : stableSeed(`${plan.title ?? ''}/${moment.id}`),
  }
}

function stableSeed(key) {
  return parseInt(createHash('sha256').update(key).digest('hex').slice(0, 8), 16) % 2147483647
}

function sentence(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return ''
  return /[.!?…"]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}
