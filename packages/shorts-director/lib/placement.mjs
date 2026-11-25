// 자리를 정하지 않은 화면 문구(position 없음)가 기본 자리에서 얼굴·주인공 사물을 가리면, 가리지 않는 가장 가까운 높이로 옮긴다.
// 기본 자리가 괜찮으면 그대로 둔다 — 얼굴 없는 영상은 전과 똑같이 나온다. 어느 높이든 가리면 글자를 줄여 다시 찾고,
// 그래도 가리면 가장 덜 가리는 자리를 고른다(남은 가림은 render 가 알린다).
// 좌표는 모두 위에서 잰 화면 비율이고, range 는 문구 중심이 올 수 있는 높이(위·아래 플랫폼 UI·자막 띠를 뺀 곳)다.
import { textProblems } from './textcheck.mjs'

const STEP = 0.01
const SCALES = [1, 0.85, 0.7]

export function choosePlacement({ box, faces = [], subjects = [], range }) {
  if (!blocking(box, faces, subjects)) return { moved: false, box, scale: 1 }
  let fallback
  for (const scale of SCALES) {
    const sized = resize(box, scale)
    const options = heights(sized, range).map((y) => ({ ...sized, y }))
    const clear = options.filter((option) => !blocking(option, faces, subjects))
    if (clear.length) {
      const nearest = clear.reduce((best, option) => (Math.abs(option.y - box.y) < Math.abs(best.y - box.y) ? option : best))
      return { moved: true, box: round(nearest), scale }
    }
    for (const option of options) {
      const cost = covered(option, faces, subjects)
      if (!fallback || cost < fallback.cost - 1e-9 || (Math.abs(cost - fallback.cost) < 1e-9 && Math.abs(option.y - box.y) < Math.abs(fallback.box.y - box.y))) {
        fallback = { cost, box: option, scale }
      }
    }
  }
  return { moved: true, box: round(fallback.box), scale: fallback.scale }
}

// 가장자리 닿음은 높이를 바꿔도 그대로라 자리를 옮길 이유가 아니다.
function blocking(box, faces, subjects) {
  return textProblems({ box, faces, subjects }).some((problem) => problem.kind !== 'edge')
}

// 얼굴은 가린 비율을 그대로, 사물은 절반 무게로 더한다 — 얼굴을 덜 가리는 쪽을 먼저 고른다.
function covered(box, faces, subjects) {
  const share = (other) => overlap(box, other) / Math.max(1e-9, other.w * other.h)
  return faces.reduce((sum, face) => sum + share(face), 0) + subjects.reduce((sum, subject) => sum + share(subject) * 0.5, 0)
}

function heights(box, [low, high]) {
  const ys = []
  for (let centre = low; centre <= high + 1e-9; centre += STEP) ys.push(centre - box.h / 2)
  return ys
}

function resize(box, scale) {
  const w = box.w * scale
  const h = box.h * scale
  return { x: box.x + (box.w - w) / 2, y: box.y + (box.h - h) / 2, w, h }
}

function overlap(a, b) {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

function round(box) {
  const r = (value) => Math.round(value * 1000) / 1000
  return { x: r(box.x), y: r(box.y), w: r(box.w), h: r(box.h) }
}
