/**
 * Discord text -> `sessions.control` operation, off the exact DTO Core parses
 * (desktop `src/domain/channelProtocol.ts`: `CHANNEL_SESSION_OPERATIONS`).
 *
 * Two independent inbound shapes exist. `MESSAGE_CREATE` text is parsed here the same `/word`
 * prefix convention as Telegram and Slack. Real Discord Application Commands arrive as a
 * Core-normalized structured fact instead (`intakeLoop.ts`'s `command` field) — see
 * `mapDiscordStructuredCommand` below, which never re-tokenizes text for that path.
 *
 * Invariant: never strips a leading mention. This adapter has no Core-verified fact about which
 * snowflake is its own bot user, so a mention naming someone else must not be treated as "the bot
 * was addressed" — doing so would let `<@someone-else> /stop` execute as a bare `/stop`. A message
 * opening with a mention is read as plain prompt text, unmodified beyond markup resolution.
 */

export interface DiscordCommand {
  operation: 'create' | 'prompt' | 'stop' | 'status' | 'projects' | 'select'
  sessionRef?: string
  text?: string
}

/** The exact seven commands declared in `extension.json`'s `channels[0].commands`. */
export interface DiscordStructuredCommand {
  name: 'pair' | 'new' | 'use' | 'projects' | 'status' | 'stop' | 'prompt'
  args: Readonly<Record<string, string>>
}

export type DiscordControlProposal =
  | { operation: 'create' }
  | { operation: 'select'; sessionRef: string }
  | { operation: 'prompt'; text: string }
  | { operation: 'projects' | 'status' | 'stop' }

/**
 * A Core-normalized Application Command interaction, mapped without re-tokenizing anything.
 *
 * `new`'s `project`/`agent`/`model`/`effort` are deliberately **not** read here or forwarded on
 * the wire: Core already holds the trusted interaction fact behind the event handle and derives
 * its own `ChannelCreateRequest` from that when it resolves this proposal, exactly as agreed in
 * the P3 contract ("no create wire addition"). Sending `operation: 'create'` alone is the whole
 * proposal — anything more here would be this adapter re-deciding what Core already decided.
 *
 * `pair` is Core's own concern, consumed before an adapter ever sees `channels.receive` — a
 * `pair` command reaching here is unexpected, so it is refused (`null`) rather than risked as a
 * `prompt` that would leak a pairing code into a session. The same refusal covers a `use`/`prompt`
 * whose required argument is missing: Discord itself enforces `required` options before an
 * interaction can be created, so an absent one here means something is wrong upstream, not that a
 * looser interpretation is safe to guess.
 */
export function mapDiscordStructuredCommand(command: DiscordStructuredCommand): DiscordControlProposal | null {
  switch (command.name) {
    case 'pair':
      return null
    case 'new':
      return { operation: 'create' }
    case 'use': {
      const sessionRef = command.args.session_id
      return sessionRef ? { operation: 'select', sessionRef } : null
    }
    case 'prompt': {
      const text = command.args.text
      return text ? { operation: 'prompt', text } : null
    }
    case 'projects':
      return { operation: 'projects' }
    case 'status':
      return { operation: 'status' }
    case 'stop':
      return { operation: 'stop' }
    default:
      return null
  }
}

/**
 * Discord's mention/channel/role/emoji markup, resolved to plain text. Ids are left in place —
 * resolving one to its real name needs a Discord REST lookup Core does not perform today.
 */
export function normalizeDiscordText(rawText: string): string {
  return rawText
    .replace(/<@!?(\d+)>/g, '@$1')
    .replace(/<@&(\d+)>/g, '@&$1')
    .replace(/<#(\d+)>/g, '#$1')
    .replace(/<a?:(\w+):\d+>/g, ':$1:')
}

const SLASH_COMMAND = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:\s+([\s\S]*))?$/

export function parseDiscordCommand(rawText: string): DiscordCommand {
  const trimmed = normalizeDiscordText(rawText).trim()
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
