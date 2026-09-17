import type { ExtensionChannelReplyFormatRequest } from '@buzzni/saycode-extension-sdk'

/**
 * Splits `text` into chunks of at most `maxUnits` UTF-16 code units, never inside a surrogate
 * pair. Concatenating the result always reproduces `text` exactly: nothing is added, and nothing
 * is dropped.
 *
 * Identical to Telegram's `utf16SafeChunks` (`packages/telegram/src/reply.ts`); duplicated because
 * this package owns no shared file (proposed to root once a third provider needs the same rule).
 */
function utf16SafeChunks(text: string, maxUnits: number): string[] {
  const chunks: string[] = []
  let index = 0
  const length = text.length
  while (index < length) {
    let end = Math.min(index + maxUnits, length)
    if (end < length) {
      const boundary = text.charCodeAt(end - 1)
      if (boundary >= 0xd800 && boundary <= 0xdbff) {
        end -= 1
        if (end <= index) end = index + 2
      }
    }
    chunks.push(text.slice(index, end))
    index = end
  }
  return chunks
}

export class SlackReplyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackReplyFormatError'
  }
}

/**
 * Core hands over only its own approved final/status text (R14); this only reshapes it for
 * Slack's per-message limit (3000 chars — `channelProviderProfiles.ts`'s `outbound.maxTextLength`
 * for Slack). It never appends truncation markers or part numbers: appending anything would mean
 * the concatenated chunks no longer equal `input.text`.
 */
export function formatSlackReply(
  input: Pick<ExtensionChannelReplyFormatRequest, 'text' | 'maxChunkUtf16Units' | 'maxChunks'>,
): { chunks: readonly string[] } {
  if (!Number.isInteger(input.maxChunkUtf16Units) || input.maxChunkUtf16Units < 1) {
    throw new SlackReplyFormatError('maxChunkUtf16Units must be a positive integer')
  }
  if (!Number.isInteger(input.maxChunks) || input.maxChunks < 1) {
    throw new SlackReplyFormatError('maxChunks must be a positive integer')
  }
  if (input.text.length === 0) return { chunks: [] }

  const chunks = utf16SafeChunks(input.text, input.maxChunkUtf16Units)
  if (chunks.length > input.maxChunks) {
    throw new SlackReplyFormatError(
      `text requires ${chunks.length} chunks, over the ${input.maxChunks} chunk limit`,
    )
  }
  return { chunks: Object.freeze(chunks) }
}
