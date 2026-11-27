// 완성본에서 시청자에게 실제로 닿는 것만 시간순으로 적는다(out/viewer.md): 컷마다 화면, 그 시각의 화면 글자, 들리는 말.
// 의도·이유는 적지 않는다 — 완성본 시청자 점검을 맡는 하위 에이전트가 작성자의 의도 없이 이 글과 접촉 시트만 보게 한다.
import { captionEvents } from './captions.mjs'
import { bandLayout } from './formats.mjs'

export function viewerScript(plan, narration = [], { label = '완성본', sheet = 'out/contact.png', every = 1.5 } = {}) {
  const screen = captionEvents({ ...plan, subtitles: false }, [], bandLayout(plan)?.frame)
  const rows = []
  let cursor = 0
  for (const moment of plan.moments ?? []) {
    const shots = moment.shots?.length ? moment.shots : [{ seconds: moment.seconds }]
    shots.forEach((shot, index) => {
      const start = cursor
      const end = round(cursor + Number(shot.seconds))
      const words = screen.filter((event) => event.start < end && event.end > start).map((event) => event.text.replaceAll('\n', ' '))
      const heard = [
        ...narration.filter((line) => line.start >= start && line.start < end).map((line) => line.text),
        ...(index === 0 ? (moment.dialogue ?? []).map((line) => `${line.speaker}: "${line.text}"`) : []),
      ]
      rows.push(`| ${round(start)}–${end}초 | ${picture(moment, shot)} | ${words.join(' · ') || '—'} | ${heard.join(' · ') || '—'} |`)
      cursor = end
    })
  }
  return [
    `# 시청자에게 닿는 것 — ${plan.title ?? '숏폼'} (${label})`,
    '',
    `이것이 영상의 전부다. 화면 칸은 기획한 묘사라, 실제 화면은 ${sheet} 로 본다(${every}초 간격, 왼쪽 위부터 0초·${every}초·${round(every * 2)}초…, 칸마다 왼쪽 위에 시각이 적혀 있다).`,
    '자막은 들리는 말과 같은 글이 화면 아래에 뜬다.',
    '',
    '| 시각 | 화면 | 화면 글자 | 들리는 말 |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n')
}

function picture(moment, shot) {
  if (moment.kind === 'card') return '글자 카드'
  if (moment.kind === 'photo') return `사진 ${moment.file}: ${shot.action ?? ''}`.trim()
  return [shot.framing, shot.action].filter(Boolean).join(': ') || moment.place || moment.id
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
