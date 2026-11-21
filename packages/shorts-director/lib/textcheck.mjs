// 렌더된 화면 문구가 얼굴(위로 잘린 얼굴 포함)·주인공 사물을 가리거나 화면 가장자리를 넘는지 잰다. 문구 상자는 caption.jxa.js 가 실제로 그린
// 영역이고, 얼굴·대상은 그 순간의 글자 없는 화면에서 Vision 으로 찾는다(vision.jxa.js). 값은 모두 화면 비율, 위에서부터.
// 기준은 shorts_maker 와 같다: 얼굴은 15%, 사물은 가장자리를 덮어도 괜찮아 가운데 영역의 25%.

const MAX_FACE_COVER = 0.15
const MAX_SUBJECT_COVER = 0.25
// 사물의 "가운데" — 상자를 가로세로 절반으로 줄인 영역.
const SUBJECT_CORE = 0.5
// 문구가 이보다 화면 가장자리에 붙으면 잘리거나 플랫폼 UI 에 닿는다(좌우 3%).
const SIDE_MARGIN = 0.03

export function textProblems({ box, faces = [], subjects = [] }) {
  const problems = []
  for (const face of faces) {
    const share = overlap(box, face) / area(face)
    if (share > MAX_FACE_COVER) problems.push({ kind: 'face', share: round(share) })
  }
  for (const subject of subjects) {
    const core = shrink(subject, SUBJECT_CORE)
    const share = overlap(box, core) / area(core)
    if (share > MAX_SUBJECT_COVER) problems.push({ kind: 'subject', share: round(share) })
  }
  if (box.x < SIDE_MARGIN || box.x + box.w > 1 - SIDE_MARGIN) problems.push({ kind: 'edge', share: 0 })
  // 여러 장면에서 본 같은 얼굴·대상은 종류마다 가장 많이 가린 값 하나로 알린다.
  const worst = new Map()
  for (const problem of problems) if (!worst.has(problem.kind) || worst.get(problem.kind).share < problem.share) worst.set(problem.kind, problem)
  return [...worst.values()]
}

// 화면 위로 잘린 얼굴(코·입만 보이는 클로즈업)은 얼굴 감지가 놓친다. 사람 영역(person segmentation 격자)이 윗변에 닿아 있고
// 그 자리에 감지된 얼굴이 없으면, 윗변에 닿은 폭만큼의 머리가 잘려 있다고 보고 머리 높이는 폭의 1.25배로 잡는다.
// 윗변을 거의 다 채우면(90% 넘게) 머리가 아니라 어깨·몸통이다.
const HEAD_HEIGHT_PER_WIDTH = 1.25
const MAX_HEAD_SPAN = 0.9
// 이보다 좁은 조각(머리카락 몇 가닥, 멀리 있는 사람)은 머리로 보지 않는다.
const MIN_HEAD_SPAN = 0.08

export function croppedHeads(person, faces = [], { aspect }) {
  if (!person?.lines?.length) return []
  const top = person.lines[0]
  const runs = [...top.matchAll(/#+/g)].map((run) => ({ x: run.index / person.cols, w: run[0].length / person.cols }))
  return runs
    .filter((run) => run.w >= MIN_HEAD_SPAN && run.w <= MAX_HEAD_SPAN)
    .map((run) => ({ x: run.x, y: 0, w: run.w, h: Math.min(1, HEAD_HEIGHT_PER_WIDTH * run.w * aspect) }))
    .filter((head) => !faces.some((face) => overlap(head, face) > 0))
}

function overlap(left, right) {
  const w = Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x)
  const h = Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y)
  return w > 0 && h > 0 ? w * h : 0
}

function area(rect) {
  return Math.max(rect.w * rect.h, 1e-9)
}

function shrink(rect, ratio) {
  return { x: rect.x + (rect.w * (1 - ratio)) / 2, y: rect.y + (rect.h * (1 - ratio)) / 2, w: rect.w * ratio, h: rect.h * ratio }
}

function round(value) {
  return Math.round(value * 100) / 100
}
