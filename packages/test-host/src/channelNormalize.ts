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
      const projection = throughWire(message.projection ?? {})
      checkProjection(projection, `items[${index}].projection`)
      return {
        itemRef: `i${index}`,
        primaryText: text(message.primaryText, `items[${index}].primaryText`),
        projection,
        maxAdditionsBytes: purpose === 'currentInput'
          ? ADDITIONS_BYTES.currentInput
          : message.root ? ADDITIONS_BYTES.root : ADDITIONS_BYTES.reply,
      }
    }),
  }
}

/**
 * What the other side of Desktop's JSON wire receives: a separate copy, with holes in arrays turned
 * into `null` and `undefined` keys gone — so a normalizer can neither change the request Core judges
 * its result against nor pass a value that only exists in memory.
 */
export function throughWire<T>(value: T): T {
  const serialized = JSON.stringify(value)
  return serialized === undefined ? undefined as T : JSON.parse(serialized) as T
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
//
// Every shape lists its fields with their checks and which are required; anything else is a field Core
// never copies, so a test that relies on it would pass against a host that cannot exist.

type Check = (value: unknown, path: string) => void
type Shape = Record<string, Check>

const string: Check = (value, path) => { text(value, path) }
const boolean: Check = (value, path) => {
  if (typeof value !== 'boolean') throw new Error(`${path}: expected a boolean`)
}
const size: Check = (value, path) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${path}: expected a byte count`)
}
const oneOf = (...values: string[]): Check => (value, path) => {
  if (!values.includes(value as string)) throw new Error(`${path}: unsupported ${String(value)}`)
}
const httpUrl: Check = (value, path) => {
  if (typeof value !== 'string' || value.length > 2048 || !/^https?:\/\//i.test(value)) {
    throw new Error(`${path}: expected an http(s) URL`)
  }
}
const listOf = (check: Check): Check => (value, path) => {
  array(value, path).forEach((entry, index) => check(entry, `${path}[${index}]`))
}
const shape = (fields: Shape, required: readonly string[] = []): Check => (value, path) => {
  const source = known(value, path, Object.keys(fields))
  const missing = required.find((key) => source[key] === undefined)
  if (missing !== undefined) throw new Error(`${path}: missing field ${missing}`)
  for (const [key, check] of Object.entries(fields)) if (source[key] !== undefined) check(source[key], `${path}.${key}`)
}
/** Picks the shape by `type`; an unknown type is unsupported rather than an unknown field. */
const byType = (shapes: Record<string, Check>): Check => (value, path) => {
  const type = (value as { type?: unknown } | null)?.type
  const check = typeof type === 'string' && Object.hasOwn(shapes, type) ? shapes[type] : undefined
  if (!check) throw new Error(`${path}.type: unsupported ${String(type)}`)
  check(value, path)
}

const textObject = shape({ type: oneOf('mrkdwn', 'plain_text'), text: string }, ['type', 'text'])
const LEAVES: Record<string, Check> = {
  text: shape({ type: string, text: string, style: shape({ bold: boolean, italic: boolean, strike: boolean, code: boolean }) }, ['text']),
  link: shape({ type: string, url: httpUrl, text: string }, ['url']),
  user: shape({ type: string, user_id: string }, ['user_id']),
  channel: shape({ type: string, channel_id: string }, ['channel_id']),
  usergroup: shape({ type: string, usergroup_id: string }, ['usergroup_id']),
  emoji: shape({ type: string, name: string }, ['name']),
  broadcast: shape({ type: string, range: oneOf('here', 'channel', 'everyone') }, ['range']),
}
const CONTAINER_TYPES = ['rich_text_section', 'rich_text_quote', 'rich_text_preformatted', 'rich_text_list']

/** Depth counts the block as 1 and each container below it as one more. */
function container(depth: number): Check {
  return (value, path) => {
    if (depth > MAX_DEPTH) throw new Error(`${path}: deeper than ${MAX_DEPTH}`)
    shape({
      type: string,
      elements: listOf(byType({ ...LEAVES, ...containersAt(depth + 1) })),
      style: oneOf('bullet', 'ordered'),
    }, ['elements'])(value, path)
  }
}
function containersAt(depth: number): Record<string, Check> {
  return Object.fromEntries(CONTAINER_TYPES.map((type) => [type, container(depth)]))
}
/** A block's own elements are containers; below that, containers and leaves mix. */
const richTextElements = listOf(byType(containersAt(2)))

const block = byType({
  rich_text: shape({ type: string, elements: richTextElements }, ['elements']),
  section: shape({ type: string, text: textObject, fields: listOf(textObject) }),
  header: shape({ type: string, text: textObject }, ['text']),
  context: shape({ type: string, elements: listOf(textObject) }, ['elements']),
  table: shape({ type: string, rows: listOf(listOf(byType({
    raw_text: shape({ type: string, text: string }, ['text']),
    rich_text: shape({ type: string, elements: richTextElements }, ['elements']),
  }))) }, ['rows']),
})
const blocks: Check = (value, path) => {
  if (array(value, path).length > MAX_BLOCKS) throw new Error(`${path}: at most ${MAX_BLOCKS} blocks`)
  listOf(block)(value, path)
}
const attachments: Check = (value, path) => {
  if (array(value, path).length > MAX_ATTACHMENTS) throw new Error(`${path}: at most ${MAX_ATTACHMENTS} attachments`)
  listOf(shape({
    text: string, fallback: string, pretext: string, title: string, author_name: string, footer: string,
    title_link: httpUrl, from_url: httpUrl, original_url: httpUrl, is_share: boolean, is_msg_unfurl: boolean,
    message_blocks: listOf(shape({ message: shape({ blocks }, ['blocks']) }, ['message'])),
  }))(value, path)
}
const projectionShape = shape({
  blocks,
  attachments,
  files: listOf(shape({ name: string, title: string, filetype: string, mimetype: string, size })),
  subtype: string,
})

function checkProjection(projection: ExtensionSlackMessageProjection, path: string): void {
  projectionShape(projection, path)
  if (new TextEncoder().encode(JSON.stringify(projection)).length > MAX_PROJECTION_BYTES) {
    throw new Error(`${path}: over ${MAX_PROJECTION_BYTES} bytes`)
  }
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
