// plan.json 의 테이크 장면 → 영상 백엔드에 보낼 요청. 한 테이크 안의 컷은 시간 구간으로 적는다.
// 모델 문법은 실측 전 잠정이다 — references/video-prompting.md 와 함께 고친다.

export function buildTake(moment, config) {
  const timeline = []
  let cursor = 0
  for (const shot of moment.shots ?? []) {
    const end = cursor + Number(shot.seconds)
    timeline.push(`[${format(cursor)}-${format(end)}s] ${shot.framing}: ${shot.action}`)
    cursor = end
  }
  const spoken = (moment.dialogue ?? []).map((line) => `${line.speaker} says in Korean: "${line.text}"`)
  const prompt = [
    moment.video_prompt,
    timeline.length ? `Shots (hard cuts between them, same place and moment):\n${timeline.join('\n')}` : '',
    spoken.length ? `Spoken lines:\n${spoken.join('\n')}` : '',
    config.video.quietLine,
  ].filter(Boolean).join('\n\n')

  return {
    momentId: moment.id,
    prompt,
    seconds: Number(moment.seconds),
    aspect: config.aspect,
    resolution: config.video.resolution,
    ...(moment.first_frame ? { firstFrame: `stills/${moment.id}.png` } : {}),
  }
}

function format(seconds) {
  return String(Math.round(seconds * 100) / 100)
}
