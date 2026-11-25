// 화면 글자 배치. 안전 영역은 위 약 10%, 아래 약 18% — 플랫폼 UI(제목·버튼·설명)가 덮는 곳을 피한다.
// 제목류는 상자에 담고 최대 2줄, 자막은 한 줄 조각으로 말에 맞춰 바꾼다.
// ffmpeg 빌드마다 libass·drawtext 유무가 달라, 글자는 PNG 로 그려(caption.jxa.js) 겹친다.
// 좌표는 그리는 쪽(AppKit) 기준이라 y 가 아래에서 위로 잰 상자 밑변이다.

// style: box(흰 둥근 상자·남색 글자·강조어 파랑), chip(파란 칩·흰 글자), subtitle(한 줄·흰 글자·얇은 남색 외곽선), plain(콘티 카드).
const ROLES = {
  hook: { size: 0.036, anchor: 'top', maxChars: 10, maxLines: 2, style: 'box' },
  title: { size: 0.03, anchor: 'top', maxChars: 12, maxLines: 2, style: 'box' },
  info: { size: 0.034, anchor: 'upper', maxChars: 10, maxLines: 2, style: 'chip' },
  narration: { size: 0.028, anchor: 'subtitle', maxChars: 40, maxLines: 1, style: 'subtitle' },
  dialogue: { size: 0.028, anchor: 'subtitle', maxChars: 40, maxLines: 1, style: 'subtitle' },
  aside: { size: 0.03, anchor: 'aside', maxChars: 12, maxLines: 2, style: 'aside' },
  storyboard: { size: 0.026, anchor: 'center', maxChars: 22, maxLines: 5, style: 'plain' },
}
const TOP_MARGIN = 0.12
// 자막 한 줄의 밑변. 중심이 위에서 약 74.5% 에 온다(기준 영상 실측) — 플랫폼 하단 UI 위.
const SUBTITLE_BOTTOM = 0.235
// 영상 위의 칩은 중심이 위에서 약 30% — 화면 가운데의 인물·제품을 가리지 않는다. 글자 카드 위에서는 가운데.
const UPPER_CENTRE = 0.3
// 속마음·상태·해설은 위쪽 문구 아래, 화면 40% 쯤에 작게 — 사건 바로 옆의 짧은 한마디다.
const ASIDE_CENTRE = 0.4
// 속마음 한마디의 기본 노출 시간.
const ASIDE_SECONDS = 1.5
// 훅 제목은 처음 3초만 둔다. 그 뒤에도 남아 있으면 말·자막과 겹쳐 읽을 게 늘어난다.
const HOOK_SECONDS = 3
// 자막 한 조각의 폭(한글 1, 공백·문장부호 0.3, 영문·숫자 0.55 로 센다). 16 이면 54px 글자로 화면 폭의 약 80%.
const SUBTITLE_WIDTH = 16
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

// 앞 장면의 말이 제 줄이 있는 다음 장면까지 넘어가면, 앞 줄의 자막 끝이 다음 장면 화면(다른 문구) 위에 뜨고 다음 줄이 늦게 시작한다.
// 다음 장면에 제 줄이 없으면 앞 줄이 이어 말하는 것으로 보고 알리지 않는다. 0.1초 안쪽은 눈에 띄지 않는다.
export function speechPastScene(plan, lines, { tolerance = 0.1 } = {}) {
  const starts = new Map()
  let cursor = 0
  for (const moment of plan.moments ?? []) {
    starts.set(moment.id, cursor)
    cursor = round(cursor + Number(moment.seconds))
  }
  const overruns = []
  let owner
  let previous
  for (const line of lines) {
    if (line.moment && owner && owner !== line.moment && previous.end > starts.get(line.moment) + tolerance) {
      overruns.push({ id: owner, into: line.moment, over: round(previous.end - starts.get(line.moment)), text: previous.text })
    }
    if (line.moment) owner = line.moment
    previous = line
  }
  return overruns
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
  const anchor = event.position?.y !== undefined ? 'custom' : role.anchor === 'upper' && event.card ? 'center' : role.anchor
  const y = anchor === 'custom'
    ? Math.round(height * (1 - Number(event.position.y)) - h / 2)
    : anchor === 'top'
    ? Math.round(height * (1 - TOP_MARGIN)) - h
    : anchor === 'subtitle'
      ? Math.round(height * SUBTITLE_BOTTOM)
      : anchor === 'upper' || anchor === 'aside'
        ? Math.round(height * (1 - (anchor === 'aside' ? ASIDE_CENTRE : UPPER_CENTRE)) - h / 2)
        : Math.round((height - h) / 2)
  const x = Math.round(width * SIDE_MARGIN)
  return {
    text: lines.join('\n'),
    fontSize,
    x,
    y,
    w: width - 2 * x,
    h,
    style: role.style,
    anchor,
    align: event.position?.x ?? 'center',
    ...(event.emphasis ? { emphasis: event.emphasis } : {}),
    ...(event.label ? { label: event.label } : {}),
  }
}

export function captionEvents(plan, narration = []) {
  const events = []
  let cursor = 0
  for (const moment of plan.moments ?? []) {
    const start = cursor
    const end = round(cursor + Number(moment.seconds))
    if (moment.caption?.text) {
      const { text, role = 'title', emphasis, label, look, position } = moment.caption
      events.push({
        text,
        role,
        start,
        end: role === 'hook' ? round(Math.min(end, start + HOOK_SECONDS)) : end,
        ...(emphasis ? { emphasis } : {}),
        ...(label ? { label } : {}),
        ...(moment.kind === 'card' ? { card: true } : {}),
        ...(look ? { look } : {}),
        ...(position ? { position } : {}),
      })
    }
    for (const aside of moment.asides ?? []) {
      const asideStart = round(start + Number(aside.at ?? 0))
      events.push({
        text: aside.text,
        role: 'aside',
        start: asideStart,
        end: round(asideStart + Number(aside.seconds ?? ASIDE_SECONDS)),
        ...(aside.look ? { look: aside.look } : {}),
        ...(aside.position ? { position: aside.position } : {}),
      })
    }
    for (const line of moment.subtitles ?? []) {
      const lineStart = round(start + Number(line.at ?? 0))
      events.push({ text: line.text, role: 'dialogue', start: lineStart, end: round(lineStart + Number(line.seconds)) })
    }
    cursor = end
  }
  if (plan.subtitles !== false) {
    for (const line of narration) {
      for (const piece of subtitleChunks(line)) events.push({ text: piece.text, role: 'narration', start: piece.start, end: piece.end })
    }
  }
  return events
}

// 내레이션 한 줄을 한 줄짜리 자막 조각으로 나눈다. 쉼표·마침표에서 먼저 끊고, 그래도 넓으면 띄어쓰기에서 고르게 나눈다.
// 조각 시각은 음절 수에 비례해 나눈다(TTS 가 글자 시각을 주지 않는다).
export function subtitleChunks(line, { maxWidth = SUBTITLE_WIDTH } = {}) {
  // 숫자 사이의 마침표·쉼표(2.8배, 12,985명)는 문장부호가 아니다 — 거기서 끊으면 "ROAS 2." / "8배" 로 갈린다.
  const clauses = String(line.text).match(/(?:[^,.?!…]|(?<=\d)[.,](?=\d))+[,.?!…]*/g)?.map((clause) => clause.trim()).filter(Boolean) ?? []
  const pieces = []
  for (const clause of clauses) pieces.push(...splitClause(clause, maxWidth))
  for (let index = 0; index < pieces.length - 1; index += 1) {
    if (textWidth(pieces[index]) < 5 && textWidth(`${pieces[index]} ${pieces[index + 1]}`) <= maxWidth) {
      pieces.splice(index, 2, `${pieces[index]} ${pieces[index + 1]}`)
      index -= 1
    }
  }
  const weights = pieces.map((piece) => Math.max(1, syllables(piece)))
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  const span = Number(line.end) - Number(line.start)
  let cursor = Number(line.start)
  return pieces.map((text, index) => {
    const end = index === pieces.length - 1 ? Number(line.end) : round(cursor + (span * weights[index]) / total)
    const piece = { text, start: round(cursor), end }
    cursor = end
    return piece
  })
}

function splitClause(clause, maxWidth) {
  const width = textWidth(clause)
  if (width <= maxWidth) return [clause]
  const words = clause.split(/\s+/)
  const target = width / Math.ceil(width / maxWidth)
  const pieces = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && (textWidth(candidate) > maxWidth || textWidth(current) >= target)) {
      // 한 음절 낱말(다·안·못·둔…)은 보통 뒤 낱말을 꾸민다 — 조각 끝에 남기지 않고 다음 조각으로 넘긴다.
      const kept = current.split(' ')
      const carried = kept.length > 1 && syllables(kept.at(-1)) === 1 ? kept.pop() : undefined
      pieces.push(kept.join(' '))
      current = carried ? `${carried} ${word}` : word
    } else {
      current = candidate
    }
  }
  if (current) pieces.push(current)
  return pieces
}

function textWidth(text) {
  let width = 0
  for (const character of String(text)) {
    if (/[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(character)) width += 1
    else if (/[A-Za-z0-9%]/.test(character)) width += 0.55
    else width += 0.3
  }
  return width
}

function syllables(text) {
  return (String(text).match(/[가-힣]|[A-Za-z]+|\d/g) ?? []).length
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
