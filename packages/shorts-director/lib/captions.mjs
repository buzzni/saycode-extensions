// 화면 글자 배치. 안전 영역은 위 약 10%, 아래 약 18% — 플랫폼 UI(제목·버튼·설명)가 덮는 곳을 피한다.
// 제목류는 한 줄 약 8자, 최대 3줄. 글자는 상자 없이 외곽선·그림자로 선다.
// ffmpeg 빌드마다 libass·drawtext 유무가 달라, 글자는 PNG 로 그려(caption.jxa.js) 겹친다.
// 좌표는 그리는 쪽(AppKit) 기준이라 y 가 아래에서 위로 잰 상자 밑변이다.

const ROLES = {
  hook: { size: 0.05, anchor: 'top', maxChars: 8 },
  title: { size: 0.036, anchor: 'top', maxChars: 10 },
  info: { size: 0.05, anchor: 'center', maxChars: 8 },
  narration: { size: 0.034, anchor: 'bottom', maxChars: 14 },
  dialogue: { size: 0.034, anchor: 'bottom', maxChars: 14 },
  storyboard: { size: 0.026, anchor: 'center', maxChars: 22, maxLines: 5 },
}
const TOP_MARGIN = 0.12
const BOTTOM_MARGIN = 0.2
const SIDE_MARGIN = 0.06
const LINE_HEIGHT = 1.35

export function layoutNarration(lines, { start = 0, gap = 0.3 } = {}) {
  const timed = []
  let cursor = start
  for (const line of lines) {
    cursor = Math.max(cursor, Number(line.minStart ?? 0))
    const end = round(cursor + Number(line.seconds))
    const { minStart, ...rest } = line
    timed.push({ ...rest, start: round(cursor), end })
    cursor = end + gap
  }
  return timed
}

// 숏폼 내레이션은 초당 6~7.5음절이 보통이다. Qwen TTS 는 초당 5음절 남짓이라 늘어진다 — 목표까지 올리되 1.25배를 넘기지 않는다.
export function speechTempo(text, seconds, { target = 6.5, max = 1.25 } = {}) {
  const syllables = (String(text).match(/[가-힣]|[A-Za-z]+|\d/g) ?? []).length
  const rate = syllables / Number(seconds)
  if (!rate || rate >= target) return 1
  return Math.min(target / rate, max)
}

// 말이 끝난 뒤 장면이 0.4초 넘게 남으면 그 구간은 소리 없는 빈 화면이 된다. 테이크를 만들기 전에 장면을 줄이라고 알린다.
export function scenesLongerThanSpeech(plan, lines, { tolerance = 0.4 } = {}) {
  const ends = new Map()
  let cursor = 0
  for (const moment of plan.moments ?? []) {
    cursor = round(cursor + Number(moment.seconds))
    ends.set(moment.id, cursor)
  }
  const lastLine = new Map()
  for (const line of lines) if (line.moment) lastLine.set(line.moment, line)
  const idle = []
  for (const [id, line] of lastLine) {
    const gap = round(ends.get(id) - line.end)
    if (gap > tolerance) idle.push({ id, idle: gap })
  }
  return idle
}

export function wrapLine(text, maxChars = 8, maxLines = 3) {
  const lines = []
  let current = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    for (const piece of chunk(word, maxChars)) {
      const candidate = current ? `${current} ${piece}` : piece
      if (candidate.length <= maxChars || !current) {
        current = candidate
      } else {
        lines.push(current)
        current = piece
      }
    }
  }
  if (current) lines.push(current)
  balanceTail(lines, maxChars)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  kept[maxLines - 1] = `${kept[maxLines - 1]}…`
  return kept
}

export function captionBox(event, { width, height }) {
  const role = ROLES[event.role] ?? ROLES.narration
  const lines = String(event.text).split('\n').flatMap((part) => wrapLine(part, role.maxChars, role.maxLines ?? 3)).slice(0, role.maxLines ?? 3)
  const fontSize = Math.round(height * role.size)
  const h = Math.ceil(lines.length * fontSize * LINE_HEIGHT)
  const y = role.anchor === 'top'
    ? Math.round(height * (1 - TOP_MARGIN)) - h
    : role.anchor === 'bottom'
      ? Math.round(height * BOTTOM_MARGIN)
      : Math.round((height - h) / 2)
  const x = Math.round(width * SIDE_MARGIN)
  return { text: lines.join('\n'), fontSize, x, y, w: width - 2 * x, h }
}

export function captionEvents(plan, narration = []) {
  const events = []
  let cursor = 0
  for (const moment of plan.moments ?? []) {
    const start = cursor
    const end = round(cursor + Number(moment.seconds))
    if (moment.caption?.text) events.push({ text: moment.caption.text, role: moment.caption.role ?? 'title', start, end })
    for (const line of moment.subtitles ?? []) {
      const lineStart = round(start + Number(line.at ?? 0))
      events.push({ text: line.text, role: 'dialogue', start: lineStart, end: round(lineStart + Number(line.seconds)) })
    }
    cursor = end
  }
  if (plan.subtitles !== false) {
    for (const line of narration) events.push({ text: line.text, role: 'narration', start: line.start, end: line.end })
  }
  return events
}

// 마지막 줄에 한두 글자만 남지 않게, 앞줄의 끝 단어를 내려 두 줄 길이를 맞춘다.
function balanceTail(lines, maxChars) {
  while (lines.length >= 2) {
    const previous = lines.at(-2).split(' ')
    if (previous.length < 2) return
    const moved = previous.at(-1)
    const nextLast = `${moved} ${lines.at(-1)}`
    const nextPrevious = previous.slice(0, -1).join(' ')
    const before = Math.abs(lines.at(-2).length - lines.at(-1).length)
    const after = Math.abs(nextPrevious.length - nextLast.length)
    if (nextLast.length > maxChars || after >= before) return
    lines.splice(-2, 2, nextPrevious, nextLast)
  }
}

function chunk(word, size) {
  if (word.length <= size) return [word]
  const pieces = []
  for (let index = 0; index < word.length; index += size) pieces.push(word.slice(index, index + size))
  return pieces
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
