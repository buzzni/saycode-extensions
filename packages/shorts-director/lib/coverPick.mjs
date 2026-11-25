// 표지로 쓸 순간 고르기. 글자 없는 조립 화면에서 일정 간격으로 뽑은 장면마다 얼굴(없으면 주인공 사물)이 얼마나 크고
// 선명한지로 점수를 매기고, 서로 minGap 초 넘게 떨어진 상위 count 개를 돌려준다 — 같은 순간 셋이 아니라 다른 장면 셋을 보고 고르게.
// 장면이 바뀌는 순간(컷 앞뒤 0.3초)은 섞인 화면이라 빼고, 얼굴·사물이 너무 작은 장면(카드·빈 화면)도 뺀다.
const MIN_FACE = 0.01
const MIN_SUBJECT = 0.04
// 얼굴이 보이는 장면을 사물만 보이는 장면보다 먼저 고른다. 사물 찾기(돌출 영역)는 화면을 통째로 잡기도 해서(실측 70~87%),
// 화면 절반을 넘는 사물 상자는 넘는 만큼 깎는다 — 무엇이 주인공인지 모르는 화면이다.
const FACE_TIER = 1
const SUBJECT_BEST = 0.5
const NEAR_CUT = 0.3

export function pickCoverMoments(samples, { count = 3, minGap = 2, cuts = [] } = {}) {
  const blurs = samples.map((sample) => Number(sample.blur)).filter(Number.isFinite)
  const [low, high] = [Math.min(...blurs), Math.max(...blurs)]
  const scored = samples.flatMap((sample) => {
    if (cuts.some((cut) => Math.abs(cut - sample.at) < NEAR_CUT)) return []
    const faceArea = Math.max(0, ...(sample.faces ?? []).map(area))
    const subjectArea = Math.max(0, ...(sample.subjects ?? []).map(area))
    const kind = faceArea >= MIN_FACE ? 'face' : subjectArea >= MIN_SUBJECT ? 'subject' : undefined
    if (!kind) return []
    // 흐림은 이 영상 안에서 상대값으로 본다(0 = 가장 선명). 크기를 넘어설 만큼 크게 치지 않는다.
    const sharp = high > low && Number.isFinite(Number(sample.blur)) ? 1 - (Number(sample.blur) - low) / (high - low) : 1
    const size = kind === 'face' ? FACE_TIER + faceArea : subjectArea <= SUBJECT_BEST ? subjectArea : Math.max(0, 2 * SUBJECT_BEST - subjectArea)
    return [{ at: sample.at, kind, area: Math.round((kind === 'face' ? faceArea : subjectArea) * 1000) / 1000, score: size * (1 + 0.5 * sharp) }]
  })
  const picks = []
  for (const candidate of scored.sort((left, right) => right.score - left.score)) {
    if (picks.every((pick) => Math.abs(pick.at - candidate.at) >= minGap)) picks.push(candidate)
    if (picks.length === count) break
  }
  return picks.sort((left, right) => left.at - right.at).map(({ score, ...pick }) => pick)
}

function area(box) {
  return Number(box.w) * Number(box.h)
}
