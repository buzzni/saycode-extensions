import type { ExtensionChannelApprovalFormatResult, ExtensionChannelReplyFormatRequest } from '@buzzni/saycode-extension-sdk'

/**
 * Renders Core's approval prompt as one Discord message with a single action row of two buttons,
 * embedding Core's own `approvalHandle`/labels verbatim into `custom_id` so its inbound mapping
 * can read them back without trusting anything this adapter added. A basic two-button action row
 * needs no `IS_COMPONENTS_V2` flag (that governs Discord's newer layout system). Bounds below are
 * Discord's documented component limits; Core's own strict validator is the real gate and is not
 * owned here.
 */

const MAX_HANDLE_LENGTH = 80
const MAX_LABEL_LENGTH = 75
/** Discord's own documented cap for a message's `content`, independent of any caller limit. */
const MAX_CONTENT_LENGTH = 2000

export class DiscordApprovalFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscordApprovalFormatError'
  }
}

function assertBounded(value: string, max: number, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DiscordApprovalFormatError(`${field} must be a non-empty string`)
  }
  if (value.length > max) throw new DiscordApprovalFormatError(`${field} exceeds ${max} characters`)
}

export function formatDiscordApproval(
  input: Pick<ExtensionChannelReplyFormatRequest, 'text' | 'maxChunkUtf16Units' | 'maxChunks'> & {
    approval: { approvalHandle: string; approveLabel: string; denyLabel: string }
  },
): ExtensionChannelApprovalFormatResult {
  if (!Number.isInteger(input.maxChunkUtf16Units) || input.maxChunkUtf16Units < 1) {
    throw new DiscordApprovalFormatError('maxChunkUtf16Units must be a positive integer')
  }
  if (!Number.isInteger(input.maxChunks) || input.maxChunks < 1) {
    throw new DiscordApprovalFormatError('maxChunks must be a positive integer')
  }
  if (input.text.length === 0) throw new DiscordApprovalFormatError('text must not be empty')
  // The result type carries exactly one chunk, so a caller-generous `maxChunkUtf16Units` must not
  // let text past what Discord's own message `content` actually accepts — the platform cap always
  // wins, never just the caller's.
  const effectiveLimit = Math.min(input.maxChunkUtf16Units, MAX_CONTENT_LENGTH)
  if (input.text.length > effectiveLimit) {
    throw new DiscordApprovalFormatError(
      `approval text exceeds the ${effectiveLimit}-unit limit (chunk budget ${input.maxChunkUtf16Units}, Discord content cap ${MAX_CONTENT_LENGTH})`,
    )
  }
  assertBounded(input.approval.approvalHandle, MAX_HANDLE_LENGTH, 'approvalHandle')
  assertBounded(input.approval.approveLabel, MAX_LABEL_LENGTH, 'approveLabel')
  assertBounded(input.approval.denyLabel, MAX_LABEL_LENGTH, 'denyLabel')

  const handle = input.approval.approvalHandle
  return {
    chunks: [input.text],
    components: [
      {
        type: 1,
        components: [
          { type: 2, style: 3, label: input.approval.approveLabel, custom_id: `saycode:approve:${handle}` },
          { type: 2, style: 4, label: input.approval.denyLabel, custom_id: `saycode:deny:${handle}` },
        ],
      },
    ],
  }
}
