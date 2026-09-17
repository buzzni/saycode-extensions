/**
 * Telegram text -> `sessions.control` operation, off the exact DTO Core parses
 * (desktop `src/domain/channelProtocol.ts`: `CHANNEL_SESSION_OPERATIONS`).
 *
 * Never invents an operation: unrecognised `/word` text still becomes a `prompt`, on the same
 * reasoning Telegram itself uses for unknown bot commands — a literal `/` is common enough in
 * ordinary prose that guessing intent from it would surprise users more than just forwarding it.
 */

export interface TelegramCommand {
  operation: 'create' | 'prompt' | 'stop' | 'status' | 'projects' | 'select'
  sessionRef?: string
  text?: string
}

const SLASH_COMMAND = /^\/([a-zA-Z][a-zA-Z0-9_]*)(?:@[a-zA-Z0-9_]+)?(?:\s+([\s\S]*))?$/

export function parseTelegramCommand(rawText: string): TelegramCommand {
  const trimmed = rawText.trim()
  const match = SLASH_COMMAND.exec(trimmed)
  if (!match) return { operation: 'prompt', text: rawText }

  const [, word, rest] = match
  const argument = rest?.trim()
  switch (word!.toLowerCase()) {
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
    // `use` is Core's own alias for `select`, same source rules and all.
    case 'select':
    case 'use':
      // This package proposes `prompt` rather than `select` with an empty sessionRef — it never
      // decides the outcome. Core's own `classifyChannelIntent` still reads a bare `/select` or
      // `/use` as a `select` intent regardless of arguments, so this proposal disagrees with
      // Core's classification and Core refuses the request; it is not accepted as an ordinary
      // prompt.
      return argument ? { operation: 'select', sessionRef: argument } : { operation: 'prompt', text: rawText }
    default:
      return { operation: 'prompt', text: rawText }
  }
}
