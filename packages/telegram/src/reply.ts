import type { ExtensionChannelReplyFormatRequest } from '@buzzni/saycode-extension-sdk'

/**
 * Splits `text` into chunks of at most `maxUnits` UTF-16 code units, never inside a surrogate
 * pair. Concatenating the result always reproduces `text` exactly: nothing is added, and nothing
 * is dropped.
 *
 * A boundary that would fall between a high and low surrogate is pulled back by one unit so the
 * pair stays together — except when `maxUnits` is 1 and the pulled-back boundary would produce an
 * empty chunk, in which case the pair is kept whole and that one chunk is 2 units. A 1-unit cap
 * that could still split code points would corrupt the character it cuts through; carrying the
 * whole pair is a smaller deviation than emitting invalid UTF-16.
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

export class TelegramReplyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TelegramReplyFormatError'
  }
}

/**
 * Core hands over only its own approved final/status text (R14); this only reshapes it for
 * Telegram's per-message limit. It never appends truncation markers or part numbers — appending
 * anything would mean the concatenated chunks no longer equal `input.text`.
 */
export function formatTelegramReply(
  input: Pick<ExtensionChannelReplyFormatRequest, 'text' | 'maxChunkUtf16Units' | 'maxChunks'>,
): { chunks: readonly string[] } {
  if (!Number.isInteger(input.maxChunkUtf16Units) || input.maxChunkUtf16Units < 1) {
    throw new TelegramReplyFormatError('maxChunkUtf16Units must be a positive integer')
  }
  if (!Number.isInteger(input.maxChunks) || input.maxChunks < 1) {
    throw new TelegramReplyFormatError('maxChunks must be a positive integer')
  }
  if (input.text.length === 0) return { chunks: [] }

  const chunks = utf16SafeChunks(input.text, input.maxChunkUtf16Units)
  if (chunks.length > input.maxChunks) {
    // Never silently drop the tail of a user-visible answer: that is the one failure mode R14
    // exists to prevent. Refusing is the honest outcome; Core decides how to handle refusal.
    throw new TelegramReplyFormatError(
      `text requires ${chunks.length} chunks, over the ${input.maxChunks} chunk limit`,
    )
  }
  return { chunks: Object.freeze(chunks) }
}
