/**
 * Slack text -> `sessions.control` operation, off the exact DTO Core parses
 * (desktop `src/domain/channelProtocol.ts`: `CHANNEL_SESSION_OPERATIONS`).
 *
 * `text` is Slack's raw mrkdwn (`payload.event.text`, unescaped by nothing upstream), so this file
 * resolves entity syntax before reading a command.
 *
 * Invariant: never strips a leading mention. This adapter has no Core-verified fact about which
 * user id is its own bot, so a mention naming someone else must not be treated as "the bot was
 * addressed" — doing so would let `<@someone-else> /stop` execute as a bare `/stop`. A message
 * opening with a mention is read as plain prompt text, unmodified beyond markup resolution.
 *
 * Never invents an operation: unrecognised `/word` text still becomes a `prompt`.
 */

export interface SlackCommand {
  operation: 'create' | 'prompt' | 'stop' | 'status' | 'projects' | 'select'
  sessionRef?: string
  text?: string
}

const HTML_ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&amp;/g, '&'],
]

/** A link body Slack would actually auto-link: an absolute URL or a `mailto:` address. */
const LINK_BODY = /^(?:[a-zA-Z][a-zA-Z0-9+.-]*:\/\/|mailto:)/

/**
 * Slack's *recognized* bracketed entity syntax, resolved to plain text — and nothing else.
 *
 * `<([^>]+)>` alone is too permissive: it would also match a plain `<div>` or a pasted
 * `<some code>` that a user typed literally, stripping brackets from content that was never Slack
 * markup. So only bodies with a form Slack itself would render specially are rewritten
 * (`@user`, `#channel`, `!here`/`!channel`/`!everyone`/`!subteam^…`, and links); every other
 * `<...>` span — including ordinary bracketed text or code — is left completely untouched,
 * brackets included.
 *
 * `<@U0123|name>` and `<@U0123>` both become a `@`-prefixed mention (the id when Slack sent no
 * display name — resolving an id to a real display name needs a `users.info` lookup Core does not
 * perform today).
 */
function resolveSlackEntities(text: string): string {
  return text.replace(/<([^>]+)>/g, (whole, inner: string) => {
    if (inner === '!here' || inner === '!channel' || inner === '!everyone') return `@${inner.slice(1)}`
    const pipeIndex = inner.indexOf('|')
    const body = pipeIndex === -1 ? inner : inner.slice(0, pipeIndex)
    const label = pipeIndex === -1 ? null : inner.slice(pipeIndex + 1)
    if (body.startsWith('@')) return `@${label ?? body.slice(1)}`
    if (body.startsWith('#')) return `#${label ?? body.slice(1)}`
    if (body.startsWith('!subteam^')) return label ? `@${label}` : whole
    if (LINK_BODY.test(body)) return label ? `${label} (${body})` : body
    // Not a recognized Slack entity form (plain bracketed text, code, etc.) — left verbatim.
    return whole
  })
}

/**
 * Order matters: Slack's bracket syntax (`<@U0123>`, `<https://x|label>`) is never HTML-escaped by
 * Slack, while literal `<`/`>` typed by a user always are (`&lt;`/`&gt;`). Resolving brackets
 * first and unescaping entities second means a literal `&lt;c&gt;` in the message is restored to
 * `<c>` only *after* the bracket pass has already run, so it can never be mistaken for syntax.
 */
export function normalizeSlackText(rawText: string): string {
  const resolved = resolveSlackEntities(rawText)
  let text = resolved
  for (const [pattern, replacement] of HTML_ENTITIES) text = text.replace(pattern, replacement)
  return text
}

const SLASH_COMMAND = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:\s+([\s\S]*))?$/

export function parseSlackCommand(rawText: string): SlackCommand {
  const trimmed = normalizeSlackText(rawText).trim()
  const match = SLASH_COMMAND.exec(trimmed)
  if (!match) return { operation: 'prompt', text: trimmed }

  const [, word = '', rest] = match
  const argument = rest?.trim()
  switch (word.toLowerCase()) {
    // `start` is Core's own alias for `new` (`classifyChannelIntent`'s `COMMAND_INTENTS`), not an
    // operation this package invents.
    case 'new':
    case 'start':
      return argument ? { operation: 'create', text: argument } : { operation: 'create' }
    case 'status':
      return { operation: 'status' }
    case 'stop':
      return { operation: 'stop' }
    case 'projects':
      return { operation: 'projects' }
    // `use` is Core's own alias for `select`, same source rules and all. A bare `/select` or
    // `/use` proposes `prompt` here, but that is only a proposal: Core's `classifyChannelIntent`
    // still reads the bare command word as `select` and refuses the mismatch — it does not fall
    // through as an ordinary prompt.
    case 'select':
    case 'use':
      return argument ? { operation: 'select', sessionRef: argument } : { operation: 'prompt', text: trimmed }
    default:
      return { operation: 'prompt', text: trimmed }
  }
}
