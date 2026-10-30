import type { ExtensionChannelRenderedChunk } from '@buzzni/saycode-extension-sdk'

import {
  fencedBlocks,
  hasLoneSurrogate,
  isFence,
  lineSpans,
  markdownLinksToText,
  nextIndexOf,
  renderedSkeleton,
  slackEscape,
  type LineSpan,
  type RenderedReplyLimits,
  verifyRenderedReply,
} from './renderedReplyCheck.js'

/**
 * The approved Markdown answer as Slack mrkdwn chunks, each naming the UTF-16 range of the answer it
 * shows (Desktop specs/slack-bot-improvements contracts §6.1–§6.3).
 *
 * Core takes the chunks only if, range by range, they show the same characters in the same order and
 * every code block byte for byte after escaping `&`, `<`, `>`. So the answer is read the way Core's
 * check reads it — code blocks and links come from the check's own parsers — and every prose line is
 * compared with its source by that check's skeleton before it is used. A line whose Slack form does not
 * compare equal is written more plainly; one that cannot be written at all throws, and Core sends the
 * whole answer by its plain path instead (§6.4).
 */

export class SlackRenderUnsupportedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackRenderUnsupportedError'
  }
}

const FENCE = '```'
/** An opening and a closing fence line, each with its newline: what wrapping code in a chunk costs. */
const FENCE_COST = 2 * (FENCE.length + 1)
const CONTROL = /[\u0000-\u0008\u000b-\u001f]/

/** A run of rows written inside one fence pair; `source` blocks are the ones Core compares byte for byte. */
interface Group { readonly kind: 'source' | 'display' }
/**
 * One piece of the answer: `[start, end)` of the source and the mrkdwn line it becomes (`null` for a
 * line that shows nothing, such as a fence). `breakBefore` keeps the pieces of one cut line apart:
 * Core reads the part of a line inside a range as one line.
 */
interface Row { start: number; end: number; text: string | null; group: Group | null; breakBefore?: boolean }

export function renderSlackMarkdown(source: string, limits: RenderedReplyLimits): ExtensionChannelRenderedChunk[] {
  if (!/\S/.test(source)) throw new SlackRenderUnsupportedError('nothing to render')
  // Core's check marks code with NUL lines, so a source holding NUL is never checked (rule 3).
  if (source.includes('\u0000')) throw new SlackRenderUnsupportedError('the answer holds NUL')
  const chunks = renderedChunks(source, limits, true)
  // Core compares tables and nested fences as text, and pairs each source code block with the first
  // rendered block of the same content — which can be one of those. Without them as blocks it cannot.
  // A result Core would still refuse is returned anyway, so Core's diagnostic names the rule.
  return verifyRenderedReply(source, { rendered: chunks }, limits).ok ? chunks : renderedChunks(source, limits, false)
}

function renderedChunks(source: string, limits: RenderedReplyLimits, displayBlocks: boolean): ExtensionChannelRenderedChunk[] {
  const chunks = packRows(sourceRows(source, limits.maxChunkUtf16Units, displayBlocks), limits.maxChunkUtf16Units)
  if (chunks.length > limits.maxChunks) throw new SlackRenderUnsupportedError(`the answer needs ${chunks.length} chunks`)
  for (const { text } of chunks) {
    if (text.length > limits.maxChunkUtf16Units) throw new SlackRenderUnsupportedError('a chunk is over the limit')
    // Characters Slack would show but Core refuses in any chunk (rule 2); dropping them would fail rule 3.
    if (CONTROL.test(text) || hasLoneSurrogate(text)) throw new SlackRenderUnsupportedError('the answer holds a control character')
    if (!/\S/.test(text)) throw new SlackRenderUnsupportedError('a chunk would be blank')
  }
  return chunks
}

// ---- chunks ----------------------------------------------------------------------------------

/** What a chunk's rows add up to so far: its length and whether a fence is open at its end. */
interface Measure { length: number; lines: number; group: Group | null; fenceOpen: boolean }

const EMPTY_MEASURE: Measure = { length: 0, lines: 0, group: null, fenceOpen: false }

/** Rows are written in order; a code group is fenced in every chunk it reaches (closed and reopened). */
function measureRow(measure: Measure, row: Row, write?: (line: string) => void): Measure {
  const next = { ...measure }
  const line = (text: string) => {
    next.length += (next.lines > 0 ? 1 : 0) + text.length
    next.lines += 1
    write?.(text)
  }
  if (row.group !== next.group) {
    if (next.fenceOpen) line(FENCE)
    next.fenceOpen = false
    next.group = row.group
  }
  if (row.text === null) return next
  if (row.group && !next.fenceOpen) {
    line(FENCE)
    next.fenceOpen = true
  }
  line(row.text)
  return next
}

const measuredLength = (measure: Measure) => measure.length + (measure.fenceOpen ? FENCE.length + 1 : 0)

/**
 * Greedy, with one preference: a code block or table that fits a chunk of its own starts a new chunk
 * instead of being cut at the end of a fuller one.
 */
function packRows(rows: Row[], maxUnits: number): ExtensionChannelRenderedChunk[] {
  const chunks: ExtensionChannelRenderedChunk[] = []
  let current: Row[] = []
  let measure = EMPTY_MEASURE
  let shows = false
  rows.forEach((row, index) => {
    const startsGroup = row.group !== null && row.group !== measure.group
    const groupAlone = startsGroup ? measuredLength(groupMeasure(rows, index)) : Infinity
    const over = measuredLength(measureRow(measure, row)) > maxUnits
    // A chosen break waits until the chunk shows something: Slack refuses a blank message.
    const chosen = row.breakBefore === true || (groupAlone <= maxUnits && measuredLength(measure) + 1 + groupAlone > maxUnits)
    if ((over && measure.lines > 0) || (chosen && shows)) {
      chunks.push(chunkOf(current))
      current = []
      measure = EMPTY_MEASURE
      shows = false
    }
    current.push(row)
    measure = measureRow(measure, row)
    shows ||= row.text !== null && /\S/.test(row.text)
  })
  if (current.length > 0) chunks.push(chunkOf(current))
  return chunks
}

function groupMeasure(rows: Row[], index: number): Measure {
  let measure = EMPTY_MEASURE
  for (let at = index; at < rows.length && rows[at]!.group === rows[index]!.group; at += 1) measure = measureRow(measure, rows[at]!)
  return measure
}

function chunkOf(rows: Row[]): ExtensionChannelRenderedChunk {
  const lines: string[] = []
  const measure = rows.reduce((sum, row) => measureRow(sum, row, (line) => lines.push(line)), EMPTY_MEASURE)
  if (measure.fenceOpen) lines.push(FENCE)
  return { text: lines.join('\n'), sourceStart: rows[0]!.start, sourceEnd: rows.at(-1)!.end }
}

// ---- rows ------------------------------------------------------------------------------------

/** `displayBlocks`: tables and nested fences as code blocks (otherwise as prose lines). */
function sourceRows(source: string, maxUnits: number, displayBlocks: boolean): Row[] {
  const spans = lineSpans(source)
  if (spans.length > 1 && spans.at(-1)!.start === source.length) spans.pop()
  const lines = spans.map((span) => source.slice(span.start, span.end))
  const codeOwner = new Map<number, Group>()
  for (const block of fencedBlocks(lines)) {
    const group: Group = { kind: 'source' }
    for (const index of block.lines) codeOwner.set(index, group)
  }
  const rows: Row[] = []
  for (let index = 0; index < lines.length;) {
    const group = codeOwner.get(index)
    if (group) {
      rows.push(...codeRows(source, spans[index]!, isFence(lines[index]!), group, maxUnits))
      index += 1
      continue
    }
    const block = displayBlocks ? tableRows(lines, spans, index, maxUnits) ?? nestedCodeRows(lines, spans, index, maxUnits, codeOwner) : null
    if (block) {
      rows.push(...block.rows)
      index = block.next
      continue
    }
    rows.push(...proseRows(source, spans[index]!, maxUnits))
    index += 1
  }
  return rows
}

/** A line of a code block Core finds in the source: shown escaped and otherwise as is (rule 4). */
function codeRows(source: string, span: LineSpan, fence: boolean, group: Group, maxUnits: number): Row[] {
  if (fence) return [{ start: span.start, end: span.next, text: null, group }]
  const line = source.slice(span.start, span.end)
  // Slack ends code at a ``` anywhere in a line, and rule 5 refuses one outside a bare fence line.
  if (line.includes(FENCE)) throw new SlackRenderUnsupportedError('a code block holds ```')
  const budget = maxUnits - FENCE_COST
  const rows: Row[] = []
  let from = span.start
  for (;;) {
    let cut = from
    let length = 0
    while (cut < span.end && length + slackEscape(source[cut]!).length <= budget) length += slackEscape(source[cut++]!).length
    if (cut < span.end && isLowSurrogate(source, cut)) cut -= 1
    if (cut >= span.end) {
      rows.push({ start: from, end: span.next, text: slackEscape(source.slice(from, span.end)), group, breakBefore: from > span.start })
      return rows
    }
    if (cut <= from) throw new SlackRenderUnsupportedError('a code line cannot fit a chunk')
    rows.push({ start: from, end: cut, text: slackEscape(source.slice(from, cut)), group, breakBefore: from > span.start })
    from = cut
  }
}

interface BlockRows { rows: Row[]; next: number }

const DELIMITER_ROW = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/

/**
 * A GFM table as an aligned table inside a code block, so its columns line up in Slack. Core compares
 * that block as text (it is not a source code block), which each row is checked against here.
 */
function tableRows(lines: string[], spans: LineSpan[], index: number, maxUnits: number): BlockRows | null {
  const header = lines[index]!
  const delimiter = lines[index + 1]
  if (!header.includes('|') || delimiter === undefined || !DELIMITER_ROW.test(delimiter)) return null
  const alignments = tableCells(delimiter).map((cell) => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left')
  if (tableCells(header).length !== alignments.length) return null
  let next = index + 2
  while (next < lines.length && lines[next]!.includes('|') && !isFence(lines[next]!)) next += 1
  const body = [index, ...range(index + 2, next)].map((line) => tableCells(lines[line]!).map((cell) => slackUnescape(inline(cell, 'plain'))))
  const columns = Math.max(...body.map((cells) => cells.length))
  const widths = range(0, columns).map((column) => Math.max(0, ...body.map((cells) => displayWidth(cells[column] ?? ''))))
  const row = (cells: string[]) => `| ${widths.map((width, column) => pad(cells[column] ?? '', width, alignments[column] ?? 'left')).join(' | ')} |`
  const shown = [row(body[0]!), `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`, ...body.slice(1).map(row)].map(slackEscape)
  const sourceLines = range(index, next)
  if (shown.some((text, at) => !sameSkeleton(text, lines[sourceLines[at]!]!) || text.length > maxUnits - FENCE_COST)) return null
  const group: Group = { kind: 'display' }
  return { rows: sourceLines.map((line, at) => ({ start: spans[line]!.start, end: spans[line]!.next, text: shown[at]!, group })), next }
}

function tableCells(line: string): string[] {
  let text = line.trim()
  if (text.startsWith('|')) text = text.slice(1)
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1)
  return text.split(/(?<!\\)\|/).map((cell) => cell.trim())
}

const NESTED_FENCE = /^([ \t]+)`{3,}(.*)$/

/**
 * A fence indented under a list item. Core does not read it as code (its fences start a line), so it
 * is compared as text: the language tag stays as a label, and the lines lose only that indentation.
 */
function nestedCodeRows(lines: string[], spans: LineSpan[], index: number, maxUnits: number, codeOwner: Map<number, Group>): BlockRows | null {
  const open = NESTED_FENCE.exec(lines[index]!)
  if (!open) return null
  let close = index + 1
  while (close < lines.length && !/^[ \t]*`{3,}\s*$/.test(lines[close]!)) {
    if (codeOwner.has(close) || lines[close]!.includes(FENCE)) return null
    close += 1
  }
  if (close >= lines.length || codeOwner.has(close)) return null
  const tag = open[2]!.trim()
  const label = tag === '' ? null : `_${slackEscape(tag)}_`
  if (label !== null ? !sameSkeleton(label, lines[index]!) : renderedSkeleton('markdown', lines[index]!) !== '') return null
  const content = range(index + 1, close)
  const indent = open[1]!.length
  const dedented = content.map((line) => slackEscape(lines[line]!.replace(new RegExp(`^[ \\t]{0,${indent}}`), '').replace(/\r$/, '')))
  const kept = content.map((line) => slackEscape(lines[line]!.replace(/\r$/, '')))
  const fits = (texts: string[]) => texts.every((text, at) => sameSkeleton(text, lines[content[at]!]!) && text.length <= maxUnits - FENCE_COST)
  const texts = fits(dedented) ? dedented : fits(kept) ? kept : null
  if (!texts) return null
  const group: Group = { kind: 'display' }
  return {
    rows: [
      { start: spans[index]!.start, end: spans[index]!.next, text: label, group: null },
      ...content.map((line, at) => ({ start: spans[line]!.start, end: spans[line]!.next, text: texts[at]!, group })),
      { start: spans[close]!.start, end: spans[close]!.next, text: null, group },
    ],
    next: close + 1,
  }
}

/** A prose line, cut between words (never inside a link or code span) when it alone is over a chunk. */
function proseRows(source: string, span: LineSpan, maxUnits: number): Row[] {
  const line = source.slice(span.start, span.end)
  const whole = proseLine(line, false)
  if (whole === null) throw new SlackRenderUnsupportedError('a line has no Slack form Core accepts')
  if (whole.length <= maxUnits) return [{ start: span.start, end: span.next, text: whole, group: null }]
  const inside = new Uint8Array(line.length + 1)
  for (const part of inlineSpans(line)) if (part.kind !== 'escape') inside.fill(1, part.start + 1, part.end)
  const between = range(1, line.length).filter((at) => !inside[at] && /[ \t]/.test(line[at - 1]!) && !/[ \t]/.test(line[at]!))
  const rows: Row[] = []
  // Rendering seldom shrinks text below half (`**` → `*`), so longer pieces are not tried: bounding each
  // try keeps a 64 KiB line well inside Core's 3 s render timeout. A piece that would have fit only
  // costs one more cut.
  const reach = 2 * maxUnits
  let from = 0
  for (;;) {
    const continuation = from > 0
    const rest = line.length - from <= reach ? proseLine(line.slice(from), continuation) : null
    if (rest !== null && rest.length <= maxUnits) {
      rows.push({ start: span.start + from, end: span.next, text: rest, group: null, breakBefore: continuation })
      return rows
    }
    const shown = (to: number) => {
      const text = proseLine(line.slice(from, to), continuation)
      return text !== null && text.length <= maxUnits ? text : null
    }
    const cut = lastFitting(between.filter((at) => at > from && at <= from + reach), shown) ?? lastFitting(hardCuts(line, from, from + reach), shown)
    if (cut === null) throw new SlackRenderUnsupportedError('a line cannot be cut to fit a chunk')
    rows.push({ start: span.start + from, end: span.start + cut, text: shown(cut)!, group: null, breakBefore: continuation })
    from = cut
  }
}

/** The last of the ascending `cuts` that `shown` accepts, by binary search (longer pieces render longer). */
function lastFitting(cuts: number[], shown: (to: number) => string | null): number | null {
  let low = 0
  let high = cuts.length - 1
  let found: number | null = null
  while (low <= high) {
    const middle = (low + high) >> 1
    if (shown(cuts[middle]!) !== null) {
      found = cuts[middle]!
      low = middle + 1
    } else high = middle - 1
  }
  return found
}

/** Cuts after `from`, up to `to`, that split neither a surrogate pair nor a joined emoji or mark. */
function hardCuts(line: string, from: number, to: number): number[] {
  return range(from + 1, Math.min(to, line.length)).filter((at) => !isLowSurrogate(line, at) && line[at - 1] !== '\u200d'
    && !/^[\u200d\ufe0f\u{1f3fb}-\u{1f3ff}\p{M}]/u.test(String.fromCodePoint(line.codePointAt(at)!)))
}

// ---- one prose line --------------------------------------------------------------------------

/**
 * The Slack form of one line, or null. The full form is tried first; the plain form (links as
 * `label url`, Markdown escapes resolved, nothing else changed) follows, and each is tried again behind
 * a space, which keeps Core from reading a leading `#`, `-` or `>` the source escaped as a prefix.
 */
function proseLine(line: string, continuation: boolean): string | null {
  const text = line.replaceAll('\r', '')
  const full = continuation ? inline(text, 'mrkdwn') : blockLine(text)
  const plain = slackEscape(markdownLinksToText(text).replace(/\\([\\*_~`|#>[\]()-])/g, '$1')).replace(/`{3,}/g, '`')
  for (const candidate of [full, ` ${full}`, plain, ` ${plain}`]) if (sameSkeleton(candidate, line)) return candidate
  return null
}

function sameSkeleton(shown: string, source: string): boolean {
  return !shown.includes(FENCE) && !shown.includes('\n') && renderedSkeleton('slack-mrkdwn', shown) === renderedSkeleton('markdown', source)
}

const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/

function blockLine(line: string): string {
  if (THEMATIC_BREAK.test(line)) return '---'
  const quote = /^(?:>\s?)+/.exec(line)
  if (!quote) return unquotedLine(line)
  const rest = line.slice(quote[0].length)
  return rest === '' ? '>' : `> ${unquotedLine(rest)}`
}

function unquotedLine(line: string): string {
  const heading = /^#{1,6}\s+(.*)$/.exec(line)
  if (heading) {
    const content = heading[1]!.trim()
    return content === '' ? '' : `*${inline(content, 'heading')}*`
  }
  const bullet = /^[-*+]\s+(.*)$/.exec(line)
  if (bullet) return `• ${inline(bullet[1]!, 'mrkdwn')}`
  // Numbered and nested items keep their marker: Core reads a marker after indentation as text.
  const item = /^(\s*(?:[-*+•◦▪]|\d{1,9}[.)])\s+)(.*)$/.exec(line)
  if (item) return item[1]! + inline(item[2]!, 'mrkdwn')
  return inline(line, 'mrkdwn')
}

// ---- inline Markdown -------------------------------------------------------------------------

/** `mrkdwn`: Slack emphasis; `heading`: inside a bold heading; `plain`: no markup at all (table cells, link labels). */
type InlineMode = 'mrkdwn' | 'heading' | 'plain'
interface InlinePart { kind: 'link' | 'code' | 'escape'; start: number; end: number; out: (mode: InlineMode) => string }

const MARKDOWN_ESCAPABLE = '\\*_~`|#>[]()-'
const SLACK_URL = /^(?:https?:\/\/|mailto:)[^|>\s<]+$/
const URL_LIKE = /[A-Za-z][A-Za-z0-9+.-]*:\/\/|mailto:/i

function inline(text: string, mode: InlineMode): string {
  const parts = inlineSpans(text)
  let masked = ''
  let unmasked = 0
  for (const part of parts) {
    masked += text.slice(unmasked, part.start) + ''.repeat(part.end - part.start)
    unmasked = part.end
  }
  masked += text.slice(unmasked)
  const delimiters = emphasisDelimiters(masked, mode)
  const partAt = new Map(parts.map((part) => [part.start, part]))
  let out = ''
  for (let index = 0; index < text.length;) {
    const part = partAt.get(index)
    const delimiter = delimiters.get(index)
    if (part) {
      out += part.out(mode)
      index = part.end
    } else if (delimiter) {
      out += delimiter.out
      index += delimiter.length
    } else {
      out += slackEscape(text[index]!)
      index += 1
    }
  }
  return out
}

/**
 * Links exactly where Core's check finds them (its scan, before anything else), then code spans and
 * backslash escapes between them.
 */
function inlineSpans(text: string): InlinePart[] {
  const closeOrNewline = nextIndexOf(text, (char) => char === ']' || char === '\n')
  const parenOrSpace = nextIndexOf(text, (char) => char === ')' || /\s/.test(char))
  const links: InlinePart[] = []
  for (let index = 0; index < text.length;) {
    const open = text[index] === '!' && text[index + 1] === '[' ? index + 1 : index
    if (text[open] === '[') {
      const close = closeOrNewline[open + 1]!
      const end = text[close] === ']' && text[close + 1] === '(' ? parenOrSpace[close + 2]! : -1
      if (end > close + 2 && text[end] === ')') {
        const label = text.slice(open + 1, close)
        const url = text.slice(close + 2, end)
        links.push({ kind: 'link', start: index, end: end + 1, out: (mode) => linkText(label, url, mode) })
        index = end + 1
        continue
      }
    }
    index += 1
  }
  const parts: InlinePart[] = []
  let gapStart = 0
  for (const link of links) {
    parts.push(...codeAndEscapes(text, gapStart, link.start), link)
    gapStart = link.end
  }
  parts.push(...codeAndEscapes(text, gapStart, text.length))
  return parts
}

function codeAndEscapes(text: string, from: number, to: number): InlinePart[] {
  const parts: InlinePart[] = []
  for (let index = from; index < to;) {
    if (text[index] === '\\' && index + 1 < to && MARKDOWN_ESCAPABLE.includes(text[index + 1]!)) {
      const char = text[index + 1]!
      parts.push({ kind: 'escape', start: index, end: index + 2, out: () => slackEscape(char) })
      index += 2
      continue
    }
    if (text[index] !== '`') {
      index += 1
      continue
    }
    const run = backtickRun(text, index, to)
    const close = closingRun(text, index + run, to, run)
    if (close === -1) {
      parts.push({ kind: 'escape', start: index, end: index + run, out: () => (run >= 3 ? '`' : '`'.repeat(run)) })
      index += run
      continue
    }
    // Core's skeleton resolves escapes inside code spans too, so the code span shows them resolved.
    const content = text.slice(index + run, close).replace(/\\([\\*_~`|#>[\]()-])/g, '$1').replace(/`{3,}/g, '`')
    parts.push({ kind: 'code', start: index, end: close + run, out: (mode) => (mode === 'plain' ? slackEscape(content) : `\`${slackEscape(content)}\``) })
    index = close + run
  }
  return parts
}

function backtickRun(text: string, from: number, to: number): number {
  let end = from
  while (end < to && text[end] === '`') end += 1
  return end - from
}

function closingRun(text: string, from: number, to: number, run: number): number {
  for (let index = from; index < to;) {
    if (text[index] !== '`') {
      index += 1
      continue
    }
    const length = backtickRun(text, index, to)
    if (length === run) return index
    index += length
  }
  return -1
}

/**
 * A Slack link only for a URL Core lets a link carry, and never under a label that reads as a different
 * address; anything else keeps the label and the address as text.
 */
function linkText(label: string, url: string, mode: InlineMode): string {
  const shown = inline(label, 'plain')
  if (mode === 'plain' || !SLACK_URL.test(url)) return shown === '' ? slackEscape(url) : `${shown} ${slackEscape(url)}`
  if (shown === '' || label === url) return `<${url}>`
  if (URL_LIKE.test(label)) return `${shown} <${url}>`
  return `<${url}|${shown}>`
}

interface Delimiter { length: number; out: string }

/**
 * Markdown emphasis delimiters found in `masked` (links, code and escapes masked out) and what each
 * becomes. Emphasis markers are not compared by Core, so a misread here changes only the look. The
 * span is bounded so a line of openers without closers stays linear.
 */
function emphasisDelimiters(masked: string, mode: InlineMode): Map<number, Delimiter> {
  const delimiters = new Map<number, Delimiter>()
  let text = masked
  const pair = (pattern: RegExp, length: number, out: Record<InlineMode, [string, string]>) => {
    text = text.replace(pattern, (match: string, ...rest: unknown[]) => {
      const offset = rest.at(-2) as number
      const [open, close] = out[mode]
      delimiters.set(offset, { length, out: open })
      delimiters.set(offset + match.length - length, { length, out: close })
      return ''.repeat(length) + match.slice(length, match.length - length) + ''.repeat(length)
    })
  }
  pair(/\*\*\*(?=[^\s*])(.{1,300}?)(?<=[^\s*])\*\*\*/g, 3, { mrkdwn: ['*_', '_*'], heading: ['_', '_'], plain: ['', ''] })
  pair(/\*\*(?=\S)(.{1,300}?)(?<=\S)\*\*/g, 2, { mrkdwn: ['*', '*'], heading: ['', ''], plain: ['', ''] })
  pair(/(?<![\p{L}\p{N}])__(?=\S)(.{1,300}?)(?<=\S)__(?![\p{L}\p{N}])/gu, 2, { mrkdwn: ['*', '*'], heading: ['', ''], plain: ['', ''] })
  pair(/~~(?=\S)(.{1,300}?)(?<=\S)~~/g, 2, { mrkdwn: ['~', '~'], heading: ['~', '~'], plain: ['', ''] })
  pair(/(?<!\*)\*(?=[^\s*])(.{1,300}?)(?<=[^\s*])\*(?!\*)/g, 1, { mrkdwn: ['_', '_'], heading: ['_', '_'], plain: ['', ''] })
  pair(/(?<![\p{L}\p{N}_])_(?=[^\s_])(.{1,300}?)(?<=[^\s_])_(?![\p{L}\p{N}_])/gu, 1, { mrkdwn: ['_', '_'], heading: ['_', '_'], plain: ['', ''] })
  return delimiters
}

// ---- helpers ---------------------------------------------------------------------------------

function range(from: number, to: number): number[] {
  return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index)
}

const isLowSurrogate = (text: string, index: number) => /[\uDC00-\uDFFF]/.test(text[index] ?? '')

/** Columns a visible cell takes in Slack's monospace font: wide for Hangul, CJK and emoji, none for marks. */
function displayWidth(text: string): number {
  let width = 0
  for (const char of text) {
    if (/[\p{M}‍️]/u.test(char)) continue
    width += /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u.test(char) ? 2 : 1
  }
  return width
}

function pad(cell: string, width: number, alignment: string): string {
  const room = width - displayWidth(cell)
  if (alignment === 'right') return ' '.repeat(room) + cell
  if (alignment === 'center') return ' '.repeat(Math.floor(room / 2)) + cell + ' '.repeat(Math.ceil(room / 2))
  return cell + ' '.repeat(room)
}

const slackUnescape = (text: string) => text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
