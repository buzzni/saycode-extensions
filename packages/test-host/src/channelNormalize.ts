/**
 * Core's side of `channel.normalizeMessages`, faked for adapter tests (Desktop specs/slack-bot-improvements
 * contracts §5.2). `fakeSlackHistory` builds the request Core would send and refuses projection fields
 * Core never copies; `checkNormalizeResult` refuses what Core's strict parser would discard. Desktop's
 * own projection and parser stay authoritative — the shared fixtures there are the cross-check.
 */
import {
  CHANNEL_NORMALIZE_ADDITION_SOURCES,
  type ExtensionChannelNormalizeMessagesRequest,
  type ExtensionChannelNormalizeMessagesResult,
  type ExtensionSlackMessageProjection,
} from '@buzzni/saycode-extension-sdk'

export interface FakeSlackMessage {
  /** Stands in for Core's rendering of the message text. */
  primaryText: string
  projection?: ExtensionSlackMessageProjection
  /** The thread's parent: a 6,000-byte additions budget instead of 2,000. */
  root?: boolean
}

export interface FakeSlackHistoryOptions {
  channelId: string
  messages: FakeSlackMessage[]
  purpose?: ExtensionChannelNormalizeMessagesRequest['purpose']
  userLabels?: Record<string, string>
  connectionId?: string
  connectionRevision?: number
  requestId?: string
}

const MAX_ITEMS = 200
const MAX_BLOCKS = 50
const MAX_ATTACHMENTS = 20
const MAX_DEPTH = 6
const MAX_PROJECTION_BYTES = 16_384
const ADDITIONS_BYTES = { currentInput: 8192, root: 6000, reply: 2000 }

export function fakeSlackHistory(options: FakeSlackHistoryOptions): ExtensionChannelNormalizeMessagesRequest {
  const purpose = options.purpose ?? 'threadHistory'
  const userLabels = options.userLabels ?? {}
  if (options.messages.length > MAX_ITEMS) throw new Error(`fake Slack history: at most ${MAX_ITEMS} items`)
  if (Object.keys(userLabels).length > MAX_ITEMS) throw new Error(`fake Slack history: at most ${MAX_ITEMS} user labels`)
  if (purpose === 'currentInput' && options.messages.length !== 1) {
    throw new Error('fake Slack history: the current input is one message')
  }
  return {
    apiVersion: 2,
    channelId: options.channelId,
    connectionId: options.connectionId ?? 'connection-1',
    provider: 'slack',
    connectionRevision: options.connectionRevision ?? 1,
    requestId: options.requestId ?? 'normalize-1',
    purpose,
    userLabels,
    items: options.messages.map((message, index) => {
      const projection = message.projection ?? {}
      checkProjection(projection, `items[${index}].projection`)
      return {
        itemRef: `i${index}`,
        primaryText: message.primaryText,
        projection,
        maxAdditionsBytes: purpose === 'currentInput'
          ? ADDITIONS_BYTES.currentInput
          : message.root ? ADDITIONS_BYTES.root : ADDITIONS_BYTES.reply,
      }
    }),
  }
}

export function checkNormalizeResult(
  value: unknown,
  request: ExtensionChannelNormalizeMessagesRequest,
): ExtensionChannelNormalizeMessagesResult {
  const result = fields(value, 'normalize result', ['items'])
  const budgets = new Map(request.items.map((item) => [item.itemRef, item.maxAdditionsBytes]))
  const items = array(result.items, 'normalize result.items')
  const refs = items.map((item, index) => text(fields(item, `items[${index}]`, ['itemRef', 'additions', 'truncated']).itemRef, `items[${index}].itemRef`))
  if (refs.length !== budgets.size || new Set(refs).size !== refs.length || refs.some((ref) => !budgets.has(ref))) {
    throw new Error('normalize result: expected every requested item exactly once')
  }
  items.forEach((item, index) => {
    const path = `items[${index}]`
    const { additions, truncated } = item as Record<string, unknown>
    if (typeof truncated !== 'boolean') throw new Error(`${path}.truncated: expected a boolean`)
    let bytes = 0
    array(additions, `${path}.additions`).forEach((addition, position) => {
      const entry = fields(addition, `${path}.additions[${position}]`, ['source', 'text'])
      if (!(CHANNEL_NORMALIZE_ADDITION_SOURCES as readonly unknown[]).includes(entry.source)) {
        throw new Error(`${path}.additions[${position}].source: unsupported ${String(entry.source)}`)
      }
      const body = text(entry.text, `${path}.additions[${position}].text`)
      if (body.includes('\u0000') || /[\uD800-\uDFFF]/.test(body.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''))) {
        throw new Error(`${path}.additions[${position}].text: contains NUL or a lone surrogate`)
      }
      bytes += new TextEncoder().encode(body).length
    })
    const budget = budgets.get(refs[index]!)!
    if (bytes > budget) throw new Error(`${path}.additions: over its ${budget}-byte budget`)
  })
  return value as ExtensionChannelNormalizeMessagesResult
}

// ---- projection allow-list (contracts §5.2 SlackMessageProjection) --------------------------------

const TEXT_OBJECT = ['type', 'text']
const BLOCK_FIELDS: Record<string, string[]> = {
  rich_text: ['type', 'elements'],
  section: ['type', 'text', 'fields'],
  header: ['type', 'text'],
  context: ['type', 'elements'],
  table: ['type', 'rows'],
}
const CONTAINER_TYPES = new Set(['rich_text_section', 'rich_text_quote', 'rich_text_preformatted', 'rich_text_list'])
const LEAF_FIELDS: Record<string, string[]> = {
  text: ['type', 'text', 'style'],
  link: ['type', 'url', 'text'],
  user: ['type', 'user_id'],
  channel: ['type', 'channel_id'],
  usergroup: ['type', 'usergroup_id'],
  emoji: ['type', 'name'],
  broadcast: ['type', 'range'],
}
const ATTACHMENT_FIELDS = ['text', 'fallback', 'pretext', 'title', 'author_name', 'footer',
  'title_link', 'from_url', 'original_url', 'is_share', 'is_msg_unfurl', 'message_blocks']
const ATTACHMENT_URLS = ['title_link', 'from_url', 'original_url']
const FILE_FIELDS = ['name', 'title', 'filetype', 'mimetype', 'size']

function checkProjection(projection: ExtensionSlackMessageProjection, path: string): void {
  const source = known(projection, path, ['blocks', 'attachments', 'files', 'subtype'])
  if (source.blocks !== undefined) checkBlocks(source.blocks, `${path}.blocks`)
  if (source.attachments !== undefined) {
    const attachments = array(source.attachments, `${path}.attachments`)
    if (attachments.length > MAX_ATTACHMENTS) throw new Error(`${path}: at most ${MAX_ATTACHMENTS} attachments`)
    attachments.forEach((attachment, index) => {
      const entryPath = `${path}.attachments[${index}]`
      const entry = known(attachment, entryPath, ATTACHMENT_FIELDS)
      for (const key of ATTACHMENT_URLS) if (entry[key] !== undefined) httpUrl(entry[key], `${entryPath}.${key}`)
      if (entry.message_blocks !== undefined) {
        array(entry.message_blocks, `${entryPath}.message_blocks`).forEach((forwarded, position) => {
          const forwardPath = `${entryPath}.message_blocks[${position}]`
          const message = known(fields(forwarded, forwardPath, ['message']).message, `${forwardPath}.message`, ['blocks'])
          checkBlocks(message.blocks, `${forwardPath}.message.blocks`)
        })
      }
    })
  }
  if (source.files !== undefined) {
    array(source.files, `${path}.files`).forEach((file, index) => known(file, `${path}.files[${index}]`, FILE_FIELDS))
  }
  if (new TextEncoder().encode(JSON.stringify(projection)).length > MAX_PROJECTION_BYTES) {
    throw new Error(`${path}: over ${MAX_PROJECTION_BYTES} bytes`)
  }
}

function checkBlocks(value: unknown, path: string): void {
  const blocks = array(value, path)
  if (blocks.length > MAX_BLOCKS) throw new Error(`${path}: at most ${MAX_BLOCKS} blocks`)
  blocks.forEach((block, index) => {
    const blockPath = `${path}[${index}]`
    const type = (block as { type?: unknown } | null)?.type
    const allowed = typeof type === 'string' ? BLOCK_FIELDS[type] : undefined
    if (!allowed) throw new Error(`${blockPath}.type: unsupported ${String(type)}`)
    const entry = known(block, blockPath, allowed)
    if (type === 'rich_text') checkContainers(entry.elements, `${blockPath}.elements`, 2)
    if (type === 'section' && entry.fields !== undefined) {
      array(entry.fields, `${blockPath}.fields`).forEach((field, position) => textObject(field, `${blockPath}.fields[${position}]`))
    }
    if ((type === 'section' || type === 'header') && entry.text !== undefined) textObject(entry.text, `${blockPath}.text`)
    if (type === 'context') {
      array(entry.elements, `${blockPath}.elements`).forEach((element, position) => textObject(element, `${blockPath}.elements[${position}]`))
    }
    if (type === 'table') {
      array(entry.rows, `${blockPath}.rows`).forEach((row, rowIndex) => array(row, `${blockPath}.rows[${rowIndex}]`).forEach((cell, cellIndex) => {
        const cellPath = `${blockPath}.rows[${rowIndex}][${cellIndex}]`
        const cellType = (cell as { type?: unknown } | null)?.type
        if (cellType === 'raw_text') known(cell, cellPath, TEXT_OBJECT)
        else if (cellType === 'rich_text') checkContainers(known(cell, cellPath, ['type', 'elements']).elements, `${cellPath}.elements`, 2)
        else throw new Error(`${cellPath}.type: unsupported ${String(cellType)}`)
      }))
    }
  })
}

/**
 * A block's own elements are containers; below that, containers and leaves mix. Depth counts the
 * block as 1 and each container below it as one more.
 */
function checkContainers(value: unknown, path: string, depth: number): void {
  array(value, path).forEach((element, index) => {
    const elementPath = `${path}[${index}]`
    const type = (element as { type?: unknown } | null)?.type
    if (typeof type === 'string' && CONTAINER_TYPES.has(type)) {
      if (depth > MAX_DEPTH) throw new Error(`${elementPath}: deeper than ${MAX_DEPTH}`)
      checkContainers(known(element, elementPath, ['type', 'elements', 'style']).elements, `${elementPath}.elements`, depth + 1)
      return
    }
    const allowed = depth > 2 && typeof type === 'string' ? LEAF_FIELDS[type] : undefined
    if (!allowed) throw new Error(`${elementPath}.type: unsupported ${String(type)}`)
    const leaf = known(element, elementPath, allowed)
    if (type === 'link') httpUrl(leaf.url, `${elementPath}.url`)
    if (leaf.style !== undefined) known(leaf.style, `${elementPath}.style`, ['bold', 'italic', 'strike', 'code'])
  })
}

// ---- primitives -------------------------------------------------------------------------------

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${path}: expected an object`)
  return value as Record<string, unknown>
}

/** Only these keys, any of them optional. */
function known(value: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  const source = record(value, path)
  const unknownKey = Object.keys(source).find((key) => !allowed.includes(key))
  if (unknownKey !== undefined) throw new Error(`${path}: unknown field ${unknownKey}`)
  return source
}

/** Exactly these keys. */
function fields(value: unknown, path: string, required: readonly string[]): Record<string, unknown> {
  const source = known(value, path, required)
  const missing = required.find((key) => !(key in source))
  if (missing !== undefined) throw new Error(`${path}: missing field ${missing}`)
  return source
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`)
  return value
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`${path}: expected a string`)
  return value
}

function textObject(value: unknown, path: string): void {
  const type = known(value, path, TEXT_OBJECT).type
  if (type !== 'mrkdwn' && type !== 'plain_text') throw new Error(`${path}.type: unsupported ${String(type)}`)
}

function httpUrl(value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value)) {
    throw new Error(`${path}: expected an http(s) URL`)
  }
}
