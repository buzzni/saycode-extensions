// 효과음: 화면에서 "무슨 일이 일어난 순간"에만 짧은 소리를 붙인다. 소리는 ffmpeg 로 그 자리에서 합성해
// 패키지에 음원 파일을 싣지 않는다(재배포 라이선스 문제가 없다). 음색은 단순하니 조직 음원이 생기면 바꿔 끼운다.

// 주파수를 내리는 사인은 식 안에서 위상을 적분해(f0·t − k·t²/2) 만든다. 필터 그래프라 식에 쉼표를 쓰지 않는다.
export const SFX_KINDS = {
  pop: 'aevalsrc=0.7*sin(2*PI*(1200*t-4000*t*t))*exp(-35*t):s=48000:d=0.14',
  whoosh: 'anoisesrc=d=0.45:c=pink:a=1:r=48000,highpass=f=700,lowpass=f=5000,volume=2.5,afade=t=in:d=0.3:curve=exp,afade=t=out:st=0.3:d=0.15',
  thud: 'aevalsrc=0.7*sin(2*PI*(110*t-120*t*t))*exp(-7*t)+0.15*random(0)*exp(-60*t):s=48000:d=0.6',
  click: 'aevalsrc=0.5*sin(2*PI*2400*t)*exp(-120*t):s=48000:d=0.06',
}

const PRIORITY = { explicit: 4, thud: 3, pop: 2, whoosh: 1, click: 1 }
const MIN_SPACING = 0.6
const MAX_PER_SHORT = 8
// 휙 소리는 컷 바로 앞에서 시작해 컷에서 가장 커진다.
const WHOOSH_LEAD = 0.2

export function sfxEvents(plan) {
  if (plan.sfx === false) return []
  const candidates = []
  let cursor = 0
  for (const [index, moment] of (plan.moments ?? []).entries()) {
    const start = round(cursor)
    for (const sound of Array.isArray(moment.sfx) ? moment.sfx : []) {
      candidates.push({ kind: sound.kind, at: round(start + Number(sound.at ?? 0)), priority: PRIORITY.explicit })
    }
    if (moment.sfx !== false) {
      const role = moment.caption?.text ? moment.caption.role ?? 'title' : undefined
      if (moment.beat === 'rehook') candidates.push({ kind: 'thud', at: start, priority: PRIORITY.thud })
      if (['hook', 'title', 'info'].includes(role)) candidates.push({ kind: 'pop', at: start, priority: PRIORITY.pop })
      if (index > 0 && !moment.from?.take) candidates.push({ kind: 'whoosh', at: round(Math.max(0, start - WHOOSH_LEAD)), priority: PRIORITY.whoosh })
    }
    cursor += Number(moment.seconds)
  }

  const kept = []
  for (const candidate of candidates.sort((left, right) => right.priority - left.priority || left.at - right.at)) {
    if (kept.length >= MAX_PER_SHORT) break
    if (kept.some((other) => Math.abs(other.at - candidate.at) < MIN_SPACING)) continue
    kept.push(candidate)
  }
  return kept.sort((left, right) => left.at - right.at).map(({ kind, at }) => ({ kind, at }))
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
