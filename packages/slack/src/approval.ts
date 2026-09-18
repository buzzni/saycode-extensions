import type { ExtensionChannelApprovalFormatResult, ExtensionChannelReplyFormatRequest } from '@buzzni/saycode-extension-sdk'

/**
 * Renders Core's approval prompt as one Slack Block Kit message, embedding Core's own
 * `approvalHandle`/labels verbatim into `action_id` so its inbound mapping can read them back
 * without trusting anything this adapter added. Bounds below are Slack's documented Block Kit
 * limits and Discord's `custom_id` cap (see Discord's `approval.ts`), not values this package
 * chose; Core's own strict validator is the real gate and is not owned here.
 */

const MAX_HANDLE_LENGTH = 80
const MAX_LABEL_LENGTH = 75
/** Slack's own documented cap for a section block's `text`, independent of any caller limit. */
const MAX_SECTION_TEXT_LENGTH = 3000

export class SlackApprovalFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackApprovalFormatError'
  }
}

function assertBounded(value: string, max: number, field: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    throw new SlackApprovalFormatError(`${field} must be a non-empty string`)
  }
  if (value.length > max) throw new SlackApprovalFormatError(`${field} exceeds ${max} characters`)
}

export function formatSlackApproval(
  input: Pick<ExtensionChannelReplyFormatRequest, 'text' | 'maxChunkUtf16Units' | 'maxChunks'> & {
    approval: { approvalHandle: string; approveLabel: string; denyLabel: string }
  },
): ExtensionChannelApprovalFormatResult {
  if (!Number.isInteger(input.maxChunkUtf16Units) || input.maxChunkUtf16Units < 1) {
    throw new SlackApprovalFormatError('maxChunkUtf16Units must be a positive integer')
  }
  if (!Number.isInteger(input.maxChunks) || input.maxChunks < 1) {
    throw new SlackApprovalFormatError('maxChunks must be a positive integer')
  }
  if (input.text.length === 0) throw new SlackApprovalFormatError('text must not be empty')
  // The result type carries exactly one chunk, so a caller-generous `maxChunkUtf16Units` must not
  // let text past what Slack's own section block actually accepts — the platform cap always wins,
  // never just the caller's.
  const effectiveLimit = Math.min(input.maxChunkUtf16Units, MAX_SECTION_TEXT_LENGTH)
  if (input.text.length > effectiveLimit) {
    throw new SlackApprovalFormatError(
      `approval text exceeds the ${effectiveLimit}-unit limit (chunk budget ${input.maxChunkUtf16Units}, Slack section cap ${MAX_SECTION_TEXT_LENGTH})`,
    )
  }
  assertBounded(input.approval.approvalHandle, MAX_HANDLE_LENGTH, 'approvalHandle')
  assertBounded(input.approval.approveLabel, MAX_LABEL_LENGTH, 'approveLabel')
  assertBounded(input.approval.denyLabel, MAX_LABEL_LENGTH, 'denyLabel')

  const handle = input.approval.approvalHandle
  return {
    chunks: [input.text],
    blocks: [
      { type: 'section', text: { type: 'plain_text', text: input.text } },
      {
        type: 'actions',
        elements: [
          { type: 'button', action_id: `saycode:approve:${handle}`, text: { type: 'plain_text', text: input.approval.approveLabel } },
          { type: 'button', action_id: `saycode:deny:${handle}`, text: { type: 'plain_text', text: input.approval.denyLabel } },
        ],
      },
    ],
  }
}
