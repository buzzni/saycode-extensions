/**
 * Core's check of a `rendered` reply (Desktop specs/slack-bot-improvements contracts §6.3), ported.
 *
 * Desktop runs `verifyRenderedReply` on what `render.ts` returns and sends the plain path instead when
 * it refuses. This is the same check, kept line for line with Desktop `src/domain/channelRenderedReply.ts`
 * at abbec7b612 (with `slackPlainEscape` from `channelPlainReply.ts`): the renderer reads code blocks and
 * links with the helpers exported here and compares each line it writes with `renderedSkeleton`, and the
 * tests hold whole results to `verifyRenderedReply`, both against the shared fixtures Core's own copy
 * passes. Change it only together with Desktop and the fixtures.
 */

export type RenderedSkeletonDialect = 'markdown' | 'slack-mrkdwn'

export interface RenderedChunk { text: string; sourceStart: number; sourceEnd: number }
export interface RenderedReplyResult { rendered: readonly RenderedChunk[] }
export interface RenderedReplyLimits { maxChunkUtf16Units: number; maxChunks: number }
export type RenderedReplyRule = 1 | 2 | 3 | 4 | 5 | 6
export type RenderedReplyVerdict =
  | { ok: true; chunks: string[] }
  | { ok: false; rule: RenderedReplyRule }

/** §6.5: what Slack shows as `&`, `<` and `>`; code is compared after this escape, not as raw bytes. */
export const slackEscape = (text: string): string =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

const URL_TOKEN = '(?:https?:\\/\\/|mailto:)[^|>\\s]+'
const MRKDWN_LINK_WITH_LABEL = new RegExp(`<(${URL_TOKEN})\\|([^>\\n]*)>`, 'g')
const MRKDWN_LINK = new RegExp(`<(${URL_TOKEN})>`, 'g')
const ALLOWED_LINK_TOKEN = new RegExp(`^<(${URL_TOKEN})(?:\\|([^>\\n]*))?>$`)
/** A label that reads as an address: a link must not show one URL while pointing at another. */
const URL_LIKE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:/i

/** §6.3 `skeleton(dialect, s)`: the characters left once markup and whitespace are taken away. */
export function renderedSkeleton(dialect: RenderedSkeletonDialect, value: string): string {
  let text = value
  if (dialect === 'markdown') {
    text = markdownLinksToText(text)
  } else {
    text = text.replace(MRKDWN_LINK_WITH_LABEL, '$2 $1').replace(MRKDWN_LINK, '$1')
    text = text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
  }
  const lines: string[] = []
  for (const line of text.split('\n')) {
    if (/^[\s|:+\-]+$/.test(line) && line.includes('-')) continue
    if (isFence(line)) continue
    lines.push(line.replace(/^(?:>\s?)+/, '').replace(/^#{1,6}\s/, '').replace(/^[-*+•◦▪]\s/, ''))
  }
  let joined = lines.join('\n')
  if (dialect === 'markdown') joined = joined.replace(/\\([\\*_~`|#>[\]()-])/g, '$1')
  return joined.replace(/[*_~`|]/g, '').replace(/\s/gu, '')
}

/**
 * `[label](url)` and `![alt](url)` → `label url`, the same as the regex `!?\[([^\]\n]*)\]\(([^)\s]+)\)` but
 * linear: that regex rescans to the line end from every `[`, which a source of repeated `[` turns into
 * seconds of synchronous work inside the reply path.
 */
export function markdownLinksToText(text: string): string {
  const closeOrNewline = nextIndexOf(text, (char) => char === ']' || char === '\n')
  const parenOrSpace = nextIndexOf(text, (char) => char === ')' || /\s/.test(char))
  let out = ''
  let index = 0
  while (index < text.length) {
    const bang = text[index] === '!' && text[index + 1] === '['
    const open = bang ? index + 1 : index
    if (text[open] === '[') {
      const close = closeOrNewline[open + 1]!
      const end = text[close] === ']' && text[close + 1] === '(' ? parenOrSpace[close + 2]! : -1
      if (end > close + 2 && text[end] === ')') {
        out += `${text.slice(open + 1, close)} ${text.slice(close + 2, end)}`
        index = end + 1
        continue
      }
    }
    out += text[index]
    index += 1
  }
  return out
}

/** For every position, the first index at or after it whose character matches (text.length if none). */
export function nextIndexOf(text: string, matches: (char: string) => boolean): Int32Array {
  const next = new Int32Array(text.length + 2).fill(text.length)
  for (let index = text.length - 1; index >= 0; index -= 1) next[index] = matches(text[index]!) ? index : next[index + 1]!
  return next
}

export function verifyRenderedReply(
  source: string,
  result: RenderedReplyResult,
  limits: RenderedReplyLimits,
): RenderedReplyVerdict {
  const rule = firstFailedRule(source, result.rendered, limits)
  return rule === null ? { ok: true, chunks: result.rendered.map((chunk) => chunk.text) } : { ok: false, rule }
}

function firstFailedRule(source: string, chunks: readonly RenderedChunk[], limits: RenderedReplyLimits): RenderedReplyRule | null {
  if (!tilesSource(source, chunks, limits.maxChunks)) return 1
  if (chunks.some((chunk) => chunk.text.length > limits.maxChunkUtf16Units || hasLoneSurrogate(chunk.text)
    || /[\u0000-\u0008\u000b-\u001f]/.test(chunk.text))) return 2
  // Balanced, and bare: Slack has no language hint, so text after a rendered fence is shown — and the
  // comparison below replaces or drops fence lines, so it would never see it. Slack also opens and
  // closes code at a ``` in mid-line, which rules 3 and 4 do not see as a boundary, so ``` may appear
  // only as a whole fence line (a source whose code holds ``` goes by the plain path).
  if (chunks.some((chunk) => {
    const lines = chunk.text.split('\n')
    return lines.filter(isFence).length % 2 !== 0 || lines.some((line) => line.includes('```') && line !== '```')
  })) return 5
  if (chunks.some((chunk) => hasForbiddenToken(chunk.text, source.slice(chunk.sourceStart, chunk.sourceEnd)))) return 6
  const sourceLines = lineSpans(source)
  const sourceBlocks = fencedBlocks(sourceLines.map((line) => source.slice(line.start, line.end)))
  for (const chunk of chunks) {
    // A NUL in the source would let the code markers below be matched by the source itself.
    if (source.slice(chunk.sourceStart, chunk.sourceEnd).includes('\u0000')) return 3
    const rule = segmentRule(source, sourceLines, sourceBlocks, chunk)
    if (rule !== null) return rule
  }
  return null
}

function tilesSource(source: string, chunks: readonly RenderedChunk[], maxChunks: number): boolean {
  if (chunks.length < 1 || chunks.length > maxChunks) return false
  if (chunks[0]!.sourceStart !== 0 || chunks.at(-1)!.sourceEnd !== source.length) return false
  return chunks.every((chunk, index) => chunk.sourceStart < chunk.sourceEnd
    && (index + 1 === chunks.length || chunk.sourceEnd === chunks[index + 1]!.sourceStart)
    && !splitsSurrogatePair(source, chunk.sourceStart) && !splitsSurrogatePair(source, chunk.sourceEnd))
}

function hasForbiddenToken(text: string, segment: string): boolean {
  if (/<[!@#]/.test(text)) return true
  for (const match of text.matchAll(/<[^<>\n]*>/g)) {
    const link = ALLOWED_LINK_TOKEN.exec(match[0])
    if (!link || !segment.includes(link[1]!)) return true
    if (link[2] !== undefined && URL_LIKE.test(link[2]) && decodeEntities(link[2]) !== decodeEntities(link[1]!)) return true
  }
  return false
}

export interface LineSpan { start: number; end: number; next: number }
export interface FencedBlock { lines: number[]; content: number[] }

/** Rules 3 and 4 for one chunk: code blocks are fixed from the whole source, then matched in order. */
function segmentRule(source: string, lines: LineSpan[], blocks: FencedBlock[], chunk: RenderedChunk): 3 | 4 | null {
  const { sourceStart: start, sourceEnd: end } = chunk
  // A line belongs to the range when any of its characters or its terminating newline is in it.
  const inRange = lines.map((line, index) => ({ line, index })).filter(({ line }) => line.start < end && line.next > start)
  const inRangeIndexes = new Set(inRange.map(({ index }) => index))
  const fragment = (index: number) => source.slice(Math.max(lines[index]!.start, start), Math.min(lines[index]!.end, end))
  const blockOfLine = lineOwners(blocks)
  const textLines = chunk.text.split('\n')
  const textBlocks = fencedBlocks(textLines)
  const matchedSource = new Map<number, number>()
  const matchedText = new Map<number, number>()
  let cursor = 0
  for (const [blockIndex, block] of blocks.entries()) {
    const content = block.content.filter((index) => inRangeIndexes.has(index))
    if (content.length === 0) continue
    const wanted = content.map((index) => slackEscape(fragment(index)))
    const found = textBlocks.findIndex((candidate, index) => index >= cursor
      && candidate.content.length === wanted.length && candidate.content.every((line, i) => textLines[line] === wanted[i]))
    if (found === -1) return 4
    const marker = matchedSource.size + 1
    matchedSource.set(blockIndex, marker)
    matchedText.set(found, marker)
    cursor = found + 1
  }
  const sourceShown = withMarkers(inRange.map(({ index }) => index), blockOfLine, matchedSource, fragment)
  const textShown = withMarkers(textLines.map((_line, index) => index), lineOwners(textBlocks), matchedText, (index) => textLines[index]!)
  return renderedSkeleton('slack-mrkdwn', textShown) === renderedSkeleton('markdown', sourceShown) ? null : 3
}

/** Replaces each matched code block, fences included, with one NUL-delimited marker line. */
function withMarkers(indexes: number[], owners: Map<number, number>, matched: Map<number, number>, line: (index: number) => string): string {
  const out: string[] = []
  const emitted = new Set<number>()
  for (const index of indexes) {
    const owner = owners.get(index)
    const marker = owner === undefined ? undefined : matched.get(owner)
    if (marker === undefined) out.push(line(index))
    else if (!emitted.has(owner!)) {
      emitted.add(owner!)
      out.push(`\u0000${marker}\u0000`)
    }
  }
  return out.join('\n')
}

export function lineSpans(text: string): LineSpan[] {
  const spans: LineSpan[] = []
  let start = 0
  for (;;) {
    const newline = text.indexOf('\n', start)
    if (newline === -1) return [...spans, { start, end: text.length, next: text.length }]
    spans.push({ start, end: newline, next: newline + 1 })
    start = newline + 1
  }
}

/** Fences open and close at a line starting with three backticks; an unclosed one runs to the end. */
export function fencedBlocks(lines: readonly string[]): FencedBlock[] {
  const blocks: FencedBlock[] = []
  let open: FencedBlock | null = null
  lines.forEach((line, index) => {
    if (isFence(line)) {
      if (!open) open = { lines: [index], content: [] }
      else {
        open.lines.push(index)
        blocks.push(open)
        open = null
      }
    } else if (open) {
      open.lines.push(index)
      open.content.push(index)
    }
  })
  if (open) blocks.push(open)
  return blocks
}

function lineOwners(blocks: FencedBlock[]): Map<number, number> {
  const owners = new Map<number, number>()
  blocks.forEach((block, index) => block.lines.forEach((line) => owners.set(line, index)))
  return owners
}

export const isFence = (line: string) => line.startsWith('```')
const decodeEntities = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
export const hasLoneSurrogate = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)
const splitsSurrogatePair = (text: string, index: number) => index > 0 && index < text.length
  && /[\uD800-\uDBFF]/.test(text[index - 1]!) && /[\uDC00-\uDFFF]/.test(text[index]!)
