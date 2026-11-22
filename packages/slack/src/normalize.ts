import type {
  ExtensionChannelNormalizeAdditionSource,
  ExtensionChannelNormalizeMessagesRequest,
  ExtensionChannelNormalizeMessagesResult,
  ExtensionSlackBlockProjection,
  ExtensionSlackMessageProjection,
  ExtensionSlackRichTextContainer,
  ExtensionSlackRichTextLeaf,
  ExtensionSlackTextObject,
} from '@buzzni/saycode-extension-sdk'

import { renderSlackTextTokens, slackLinkText, slackUserLabel } from './slackTextTokens.js'

/**
 * `channel.normalizeMessages` for Slack (Desktop specs/slack-bot-improvements contracts §5.2): what a
 * message carries outside its text — quotes, forwards, tables, link previews, files, Block Kit — as
 * readable additions. Core owns the primary text and places additions in a separate data block, so
 * nothing here can change what the person wrote; it can only add what the text left out.
 *
 * The result is already in the shape Core keeps: lines that repeat the primary or an earlier addition
 * are dropped (Core's rule 3), every item is within its byte budget, and no text holds a character
 * Core's parser refuses — a single bad item would otherwise discard the whole result.
 */

type Addition = { source: ExtensionChannelNormalizeAdditionSource; text: string }
type Labels = Readonly<Record<string, string>>

const TRUNCATION_MARK = '…(잘림)'
const encoder = new TextEncoder()

export function normalizeSlackMessages(request: ExtensionChannelNormalizeMessagesRequest): ExtensionChannelNormalizeMessagesResult {
  return {
    items: request.items.map((item) => {
      const additions = withoutRepeatedLines(item.primaryText, projectionAdditions(item.projection, request.userLabels))
      return { itemRef: item.itemRef, ...withinBudget(additions, item.maxAdditionsBytes) }
    }),
  }
}

function projectionAdditions(projection: ExtensionSlackMessageProjection, labels: Labels): Addition[] {
  return [
    ...(projection.blocks ?? []).flatMap((block) => blockAdditions(block, labels)),
    ...(projection.attachments ?? []).flatMap((attachment) => attachmentAdditions(attachment, labels)),
    ...(projection.files ?? []).map((file): Addition => ({ source: 'files', text: fileText(file) })),
  ]
}

function blockAdditions(block: ExtensionSlackBlockProjection, labels: Labels): Addition[] {
  switch (block.type) {
    case 'rich_text':
      // One addition per quote container, wherever it is nested, with its marker once on its first
      // line; the text around a nested quote is its own addition.
      return block.elements.flatMap((container) => richTextAdditions(container, labels))
    case 'section':
      return [{
        source: 'blocks',
        text: [block.text, ...(block.fields ?? [])].filter((part) => part !== undefined).map((part) => textObject(part, labels)).join('\n'),
      }]
    case 'header':
      return [{ source: 'blocks', text: textObject(block.text, labels) }]
    case 'context':
      return [{ source: 'blocks', text: block.elements.map((element) => textObject(element, labels)).join(' ') }]
    case 'table':
      return [{
        source: 'table',
        text: block.rows.map((row) => row.map((cell) => cell.type === 'raw_text'
          ? cell.text
          : cell.elements.flatMap((container) => richTextAdditions(container, labels)).map((part) => part.text).join(' ')).join(' | ')).join('\n'),
      }]
    default:
      return []
  }
}

type Attachment = NonNullable<ExtensionSlackMessageProjection['attachments']>[number]

function attachmentAdditions(attachment: Attachment, labels: Labels): Addition[] {
  // Only the forwarded words: author, source link and the `fallback` summary stay out.
  if (attachment.is_share || attachment.message_blocks?.length) {
    // The forwarded blocks when they say something, else the attachment's own text.
    const fromBlocks = (attachment.message_blocks ?? [])
      .flatMap((forwarded) => forwarded.message.blocks.flatMap((block) => blockAdditions(block, labels)))
      .map((addition) => addition.text).join('\n')
    const body = fromBlocks.trim() ? fromBlocks : mrkdwn(attachment.text ?? '', labels)
    return body.trim() ? [{ source: 'forward', text: `[전달된 글] ${body}` }] : []
  }
  if (attachment.is_msg_unfurl || attachment.original_url) {
    const url = attachment.original_url ?? attachment.from_url ?? attachment.title_link
    const title = attachment.title ?? firstLine(mrkdwn(attachment.text ?? '', labels))
    const parts = [title, url].filter((part): part is string => Boolean(part?.trim()))
    return parts.length ? [{ source: 'unfurl', text: `[링크 미리보기] ${parts.join(' — ')}` }] : []
  }
  return [{
    source: 'blocks',
    text: [attachment.pretext, attachment.title, attachment.text]
      .filter((part): part is string => Boolean(part)).map((part) => mrkdwn(part, labels)).join('\n'),
  }]
}

/** A run of plain rich text, or one quote, in the order they appear. */
type Segment = { quote: boolean; text: string }

function richTextAdditions(container: ExtensionSlackRichTextContainer, labels: Labels): Addition[] {
  // One addition per quote, wherever it is nested and with its marker once on its first line; the text
  // on either side of a quote is its own addition. Order is kept, so a budget cuts from the end.
  return containerSegments(container, labels)
    .filter((segment) => segment.text.trim())
    .map((segment): Addition => segment.quote
      ? { source: 'quote', text: `[인용] ${segment.text}` }
      : { source: 'blocks', text: segment.text })
}

function containerSegments(container: ExtensionSlackRichTextContainer, labels: Labels): Segment[] {
  if (container.type === 'rich_text_quote') {
    return elementSegments(container.elements, labels).map((segment) => ({ quote: true, text: segment.text }))
  }
  if (container.type === 'rich_text_list') {
    const segments: Segment[] = []
    container.elements.forEach((element, index) => {
      if (element.type === 'rich_text_quote') {
        for (const segment of containerSegments(element, labels)) append(segments, segment)
        return
      }
      // A list item is a section of its own, not text that runs on from the marker's line.
      const marker = `${index === 0 ? '' : '\n'}${container.style === 'ordered' ? `${index + 1}. ` : '- '}`
      append(segments, { quote: false, text: marker })
      for (const segment of 'elements' in element ? containerSegments(element, labels) : [{ quote: false, text: leafText(element, labels) }]) {
        append(segments, segment)
      }
    })
    return segments
  }
  return elementSegments(container.elements, labels)
}

function elementSegments(elements: ReadonlyArray<ExtensionSlackRichTextContainer | ExtensionSlackRichTextLeaf>, labels: Labels): Segment[] {
  const segments: Segment[] = []
  for (const element of elements) {
    if (!('elements' in element)) {
      append(segments, { quote: false, text: leafText(element, labels) })
    } else if (element.type === 'rich_text_quote') {
      for (const segment of containerSegments(element, labels)) append(segments, segment)
    } else {
      append(segments, { quote: false, text: '\n' })
      for (const segment of containerSegments(element, labels)) append(segments, segment)
      append(segments, { quote: false, text: '\n' })
    }
  }
  return segments
}

/** Plain text joins the run before it; a quote always starts its own segment. */
function append(segments: Segment[], segment: Segment): void {
  const last = segments.at(-1)
  if (!segment.quote && last && !last.quote) last.text += segment.text
  else segments.push({ ...segment })
}

function leafText(element: ExtensionSlackRichTextLeaf, labels: Labels): string {
  switch (element.type) {
    case 'text': return element.text
    case 'link': return slackLinkText(element.url, element.text || undefined)
    case 'user': return slackUserLabel(element.user_id, labels)
    case 'channel': return `#${element.channel_id}`
    case 'usergroup': return '@usergroup'
    case 'emoji': return `:${element.name}:`
    case 'broadcast': return `@${element.range}`
    default: return ''
  }
}

function textObject(value: ExtensionSlackTextObject, labels: Labels): string {
  return value.type === 'mrkdwn' ? mrkdwn(value.text, labels) : value.text
}

function mrkdwn(text: string, labels: Labels): string {
  return renderSlackTextTokens(text, labels)
}

type SlackFile = NonNullable<ExtensionSlackMessageProjection['files']>[number]

function fileText(file: SlackFile): string {
  const details = [file.filetype ?? file.mimetype, file.size === undefined ? undefined : byteSize(file.size)]
    .filter((part): part is string => Boolean(part))
  // Not cut like a display label: two long names sharing a prefix must stay two files.
  const name = (file.name ?? file.title ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '') || '파일'
  return `[첨부: ${name}${details.length ? ` (${details.join(', ')})` : ''}]`
}

function byteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function firstLine(text: string): string | undefined {
  return text.split('\n').find((line) => line.trim())
}

// ---- result shaping -----------------------------------------------------------------------------

/** Core compares whole lines with whitespace folded; the same rule here keeps the result unchanged there. */
function lineKey(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function withoutRepeatedLines(primaryText: string, additions: readonly Addition[]): Addition[] {
  const seen = new Set(primaryText.split('\n').map(lineKey).filter(Boolean))
  const kept: Addition[] = []
  for (const addition of additions) {
    // Earlier text only: a line repeated inside one addition (a code block's `}`) stays, as in Core.
    const lines = clean(addition.text).split('\n').filter((line) => !seen.has(lineKey(line)))
    for (const line of lines) if (lineKey(line)) seen.add(lineKey(line))
    const text = lines.join('\n').trim()
    if (text) kept.push({ source: addition.source, text })
  }
  return kept
}

/** NUL and other control characters (tab and newline aside) dropped, a lone surrogate replaced. */
function clean(text: string): string {
  return text
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '�')
}

function withinBudget(additions: readonly Addition[], budget: number): { additions: Addition[]; truncated: boolean } {
  const kept: Addition[] = []
  let used = 0
  for (const addition of additions) {
    const bytes = encoder.encode(addition.text).length
    if (used + bytes <= budget) {
      kept.push(addition)
      used += bytes
      continue
    }
    const room = budget - used - encoder.encode(TRUNCATION_MARK).length
    const head = room > 0 ? prefixWithin(addition.text, room).trimEnd() : ''
    if (head) kept.push({ source: addition.source, text: head + TRUNCATION_MARK })
    return { additions: kept, truncated: true }
  }
  return { additions: kept, truncated: false }
}

/** The longest prefix within `bytes` UTF-8 bytes that never splits a surrogate pair. */
function prefixWithin(text: string, bytes: number): string {
  let used = 0
  let end = 0
  for (const character of text) {
    const size = encoder.encode(character).length
    if (used + size > bytes) break
    used += size
    end += character.length
  }
  return text.slice(0, end)
}
