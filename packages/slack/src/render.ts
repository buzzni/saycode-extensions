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
  const chunks = packRows(sourceRows(source, limits, displayBlocks), limits.maxChunkUtf16Units)
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
function sourceRows(source: string, limits: RenderedReplyLimits, displayBlocks: boolean): Row[] {
  const maxUnits = limits.maxChunkUtf16Units
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
    const block = displayBlocks ? tableRows(lines, spans, index, limits) ?? nestedCodeRows(lines, spans, index, maxUnits, codeOwner) : null
    if (block) {
      if (block.rows) rows.push(...block.rows)
      else for (let line = index; line < block.next; line += 1) rows.push(...proseRows(source, spans[line]!, maxUnits))
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

/** Lines `[index, next)` as one block, or (`rows: null`) as prose lines: the block could not be written. */
interface BlockRows { rows: Row[] | null; next: number }

/** A GFM delimiter row (`|:--|--:|`), read cell by cell: the one-pattern form backtracks for seconds. */
const isDelimiterRow = (line: string) => tableCells(line).every((cell) => /^:?-+:?$/.test(cell))

/**
 * A GFM table as an aligned table inside a code block, so its columns line up in Slack. Core compares
 * that block as text (it is not a source code block), which each row is checked against here.
 */
function tableRows(lines: string[], spans: LineSpan[], index: number, limits: RenderedReplyLimits): BlockRows | null {
  const header = lines[index]!
  const delimiter = lines[index + 1]
  if (!header.includes('|') || delimiter === undefined || !isDelimiterRow(delimiter)) return null
  const alignments = tableCells(delimiter).map((cell) => cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left')
  if (tableCells(header).length !== alignments.length) return null
  let next = index + 2
  while (next < lines.length && lines[next]!.includes('|') && !isFence(lines[next]!)) next += 1
  const body = [index, ...range(index + 2, next)].map((line) => tableCells(lines[line]!).map((cell) => slackUnescape(inline(cell, 'plain'))))
  const widths: number[] = []
  for (const cells of body) cells.forEach((cell, column) => { widths[column] = Math.max(widths[column] ?? 0, displayWidth(cell)) })
  // Every aligned row is at least this long (a code unit shows at most two columns). Past a chunk, or
  // past the whole reply, the table goes as prose before any row is built.
  const shortestRow = widths.reduce((length, width) => length + 3 + Math.ceil(width / 2), 1)
  const room = limits.maxChunkUtf16Units - FENCE_COST
  if (shortestRow > room || shortestRow * (body.length + 1) > limits.maxChunks * limits.maxChunkUtf16Units) return { rows: null, next }
  const row = (cells: string[]) => `| ${widths.map((width, column) => pad(cells[column] ?? '', width, alignments[column] ?? 'left')).join(' | ')} |`
  const shown = [row(body[0]!), `|${widths.map((width) => '-'.repeat(width + 2)).join('|')}|`, ...body.slice(1).map(row)].map(slackEscape)
  const sourceLines = range(index, next)
  if (shown.some((text, at) => !showsSource(text, lines[sourceLines[at]!]!) || text.length > room)) return { rows: null, next }
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
  if (label !== null ? !showsSource(label, lines[index]!) : renderedSkeleton('markdown', lines[index]!) !== '') return null
  const content = range(index + 1, close)
  const indent = open[1]!.length
  const dedented = content.map((line) => slackEscape(lines[line]!.replace(new RegExp(`^[ \\t]{0,${indent}}`), '').replace(/\r$/, '')))
  const kept = content.map((line) => slackEscape(lines[line]!.replace(/\r$/, '')))
  const fits = (texts: string[]) => texts.every((text, at) => showsSource(text, lines[content[at]!]!) && text.length <= maxUnits - FENCE_COST)
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
    // A piece that shows nothing (`# ` of a long heading) would be a blank Slack message.
    const shown = (to: number) => {
      const text = proseLine(line.slice(from, to), continuation)
      return text !== null && text.length <= maxUnits && /\S/.test(text) ? text : null
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
 * `label url`, Markdown escapes outside addresses resolved, nothing else changed) follows, and each is tried again behind
 * a space, which keeps Core from reading a leading `#`, `-` or `>` the source escaped as a prefix.
 */
function proseLine(line: string, continuation: boolean): string | null {
  // Only a CRLF line end: a CR inside the line stays, and the answer goes plain (rule 2) rather than
  // joining what it separates (`https://exa\rmple.com` must not become another address).
  const text = line.replace(/\r$/, '')
  const full = continuation ? inline(text, 'mrkdwn') : blockLine(text)
  const plain = slackEscape(unescapeOutsideAddresses(markdownLinksToText(text))).replace(/`{3,}/g, '`')
  for (const candidate of [full, ` ${full}`, plain, ` ${plain}`]) if (showsSource(candidate, line)) return candidate
  return null
}

/**
 * Whether one written line shows its source line: the same characters for Core (its skeleton), and
 * every address Slack would link written in the source as is. The second holds the address rule as a
 * whole, beyond the cases `addressRanges` keeps literal: a link written next to an address
 * (`https://x/[a](b)` → `https://x/a b`) is refused here rather than linked.
 */
function showsSource(shown: string, source: string): boolean {
  if (shown.includes(FENCE) || shown.includes('\n')) return false
  if (renderedSkeleton('slack-mrkdwn', shown) !== renderedSkeleton('markdown', source)) return false
  const visible = slackUnescape(shown)
  return addressRanges(visible).every(([start, end]) => source.includes(visible.slice(start, end)))
}

/** `---`, `***`, `___` with spaces between, in a linear check (a backtracking pattern takes seconds). */
function isThematicBreak(line: string): boolean {
  if (!/^ {0,3}[-*_]/.test(line) || /[^ \t*_-]/.test(line)) return false
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(line.replace(/[ \t]/g, ''))
}

function blockLine(line: string): string {
  if (isThematicBreak(line)) return '---'
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
interface InlinePart { kind: 'link' | 'code' | 'escape' | 'url'; start: number; end: number; out: (mode: InlineMode) => string }

const MARKDOWN_ESCAPABLE = '\\*_~`|#>[]()-'
const SLACK_URL = /^(?:https?:\/\/|mailto:)[^|>\s<]+$/
// Wider than Core's reading of an address-like label (no scheme letters needed) and linear: a label of
// one long word made Core's pattern take seconds here.
const URL_LIKE = /:\/\/|mailto:/i
/**
 * Text Slack would link — `scheme://…`, `mailto:`, `www.` in any case, and e-mail addresses — is shown
 * exactly as written: no escape or emphasis inside it is resolved, so Slack never links an address the
 * answer does not contain (what rule 6 asks of link tokens). One whose escapes Core resolves then has
 * no form Core accepts, and the answer goes plain.
 */
const ADDRESS_ANCHOR = /:\/\/|mailto:|www\.|@/gi
const ADDRESS_STOP = /[\s<>`|]/
const ADDRESS_TRAILING = /[*_~.,;:!?'")\]]/
const SCHEME_CHAR = /[A-Za-z0-9+.-]/
// Any text before `@` up to a space or bracket, so neither an escape (`first\#last@…`) nor emphasis
// (`~~a~~b@…`, `*y*x@…`) next to it is resolved into the address.
const MAIL_LOCAL_CHAR = /[^\s<>()[\]"'`,;:|@]/

/**
 * `[start, end)` of every address in `text`, in one pass: each anchor is followed to the end of its run
 * once, and the search goes on from there. Anything run-shaped around an anchor is kept, which only
 * ever keeps more text literal.
 */
function addressRanges(text: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  let covered = 0
  ADDRESS_ANCHOR.lastIndex = 0
  for (let match = ADDRESS_ANCHOR.exec(text); match; match = ADDRESS_ANCHOR.exec(text)) {
    const anchor = match.index
    const back = match[0] === '://' ? SCHEME_CHAR : match[0] === '@' ? MAIL_LOCAL_CHAR : null
    let start = anchor
    while (back && start > covered && anchor - start < 64 && back.test(text[start - 1]!)) start -= 1
    // A scheme starts with a letter (`\-https://…` is `\-` and then the address).
    while (match[0] === '://' && start < anchor && !/[A-Za-z]/.test(text[start]!)) start += 1
    const body = anchor + match[0].length
    let end = body
    while (end < text.length && !ADDRESS_STOP.test(text[end]!)) end += 1
    while (end > body && ADDRESS_TRAILING.test(text[end - 1]!)) end -= 1
    if (end > start) ranges.push([start, end])
    covered = Math.max(end, body)
    ADDRESS_ANCHOR.lastIndex = covered
  }
  return ranges
}

function unescapeOutsideAddresses(text: string): string {
  let out = ''
  let index = 0
  for (const [start, end] of [...addressRanges(text), [text.length, text.length] as [number, number]]) {
    out += text.slice(index, start).replace(/\\([\\*_~`|#>[\]()-])/g, '$1') + text.slice(start, end)
    index = end
  }
  return out
}

function inline(text: string, mode: InlineMode): string {
  const parts = inlineSpans(text)
  let masked = ''
  let unmasked = 0
  for (const part of parts) {
    masked += text.slice(unmasked, part.start) + '\ue000'.repeat(part.end - part.start)
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
 * Links exactly where Core's check finds them (its scan, before anything else), then code spans,
 * addresses and backslash escapes between them.
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
  const ranges = addressRanges(text)
  const addresses = new Map<number, number>(ranges)
  const parts: InlinePart[] = []
  let gapStart = 0
  let range = 0
  for (const link of links) {
    parts.push(...literalParts(text, gapStart, link.start, addresses), link)
    gapStart = link.end
    // An address that runs on past the link stays literal after it (`[a](ftp://x)\_y` would show `ftp://x_y`).
    while (range < ranges.length && ranges[range]![1] <= gapStart) range += 1
    if (range < ranges.length && ranges[range]![0] < gapStart) addresses.set(gapStart, ranges[range]![1])
  }
  parts.push(...literalParts(text, gapStart, text.length, addresses))
  return parts
}

function literalParts(text: string, from: number, to: number, addresses: Map<number, number>): InlinePart[] {
  const parts: InlinePart[] = []
  for (let index = from; index < to;) {
    const address = Math.min(addresses.get(index) ?? -1, to)
    if (address > index) {
      const shown = slackEscape(text.slice(index, address))
      parts.push({ kind: 'url', start: index, end: address, out: () => shown })
      index = address
      continue
    }
    // An escape never takes the first character of an address with it.
    if (text[index] === '\\' && index + 1 < to && MARKDOWN_ESCAPABLE.includes(text[index + 1]!) && !addresses.has(index + 1)) {
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
    const content = unescapeOutsideAddresses(text.slice(index + run, close)).replace(/`{3,}/g, '`')
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
      return '\ue001'.repeat(length) + match.slice(length, match.length - length) + '\ue001'.repeat(length)
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
