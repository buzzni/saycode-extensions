/**
 * `channel.normalizeMessages` (channel API 2, Slack only): Core sends the parts of a message that are
 * not in its text, and the adapter says what they add.
 *
 * Core builds every message's `primaryText` itself — people's words and Slack tokens alike — and the
 * adapter has no way to change it. What comes back is `additions` only, which Core places in a
 * separate data block, so an adapter can add a quoted or forwarded body but never edit an instruction.
 * Core refuses the whole result for any key, item or size outside this contract.
 */

/** `http:`/`https:` only, at most 2,048 characters; Core drops the key for anything else. */
export type ExtensionSlackHttpUrl = string
export interface ExtensionSlackTextObject { type: 'mrkdwn' | 'plain_text'; text: string }
export type ExtensionSlackRichTextLeaf =
  | { type: 'text'; text: string; style?: { bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean } }
  | { type: 'link'; url: ExtensionSlackHttpUrl; text?: string }
  | { type: 'user'; user_id: string }
  | { type: 'channel'; channel_id: string }
  | { type: 'usergroup'; usergroup_id: string }
  | { type: 'emoji'; name: string }
  | { type: 'broadcast'; range: 'here' | 'channel' | 'everyone' }
export interface ExtensionSlackRichTextContainer {
  type: 'rich_text_section' | 'rich_text_quote' | 'rich_text_preformatted' | 'rich_text_list'
  elements: Array<ExtensionSlackRichTextContainer | ExtensionSlackRichTextLeaf>
  style?: 'bullet' | 'ordered'
}
/** Accessories and image elements never arrive; Core copies only these shapes. */
export type ExtensionSlackBlockProjection =
  | { type: 'rich_text'; elements: ExtensionSlackRichTextContainer[] }
  | { type: 'section'; text?: ExtensionSlackTextObject; fields?: ExtensionSlackTextObject[] }
  | { type: 'header'; text: ExtensionSlackTextObject }
  | { type: 'context'; elements: ExtensionSlackTextObject[] }
  | { type: 'table'; rows: Array<Array<{ type: 'raw_text'; text: string } | { type: 'rich_text'; elements: ExtensionSlackRichTextContainer[] }>> }

/** A new object Core projects from the raw message: at most 50 blocks (depth ≤ 6) and 20 attachments; no file URL or id. */
export interface ExtensionSlackMessageProjection {
  blocks?: ExtensionSlackBlockProjection[]
  attachments?: Array<{
    text?: string; fallback?: string; pretext?: string; title?: string; author_name?: string; footer?: string
    title_link?: ExtensionSlackHttpUrl; from_url?: ExtensionSlackHttpUrl; original_url?: ExtensionSlackHttpUrl
    is_share?: boolean; is_msg_unfurl?: boolean
    /** A forwarded message's own blocks, projected by the same rules. */
    message_blocks?: Array<{ message: { blocks: ExtensionSlackBlockProjection[] } }>
  }>
  files?: Array<{ name?: string; title?: string; filetype?: string; mimetype?: string; size?: number }>
  subtype?: string
}

export interface ExtensionChannelNormalizeMessagesRequest {
  apiVersion: 2
  channelId: string
  connectionId: string
  provider: 'slack'
  connectionRevision: number
  /** Core-issued, for diagnostics only. */
  requestId: string
  purpose: 'currentInput' | 'threadHistory'
  /** Display names Core resolved, by Slack user id; at most 200. */
  userLabels: Record<string, string>
  /** At most 200, in thread order. */
  items: Array<{
    /** Core-issued `i0`..`i199`, not a Slack ts. */
    itemRef: string
    /** Read-only: lets the adapter leave out what the text already says. */
    primaryText: string
    projection: ExtensionSlackMessageProjection
    /** UTF-8 bytes for all of this item's addition texts together. */
    maxAdditionsBytes: number
  }>
}

export const CHANNEL_NORMALIZE_ADDITION_SOURCES = ['blocks', 'quote', 'forward', 'table', 'unfurl', 'files'] as const
export type ExtensionChannelNormalizeAdditionSource = (typeof CHANNEL_NORMALIZE_ADDITION_SOURCES)[number]

/** Exactly one entry per requested `itemRef` with exactly these keys; anything else discards the whole result. */
export interface ExtensionChannelNormalizeMessagesResult {
  items: Array<{
    itemRef: string
    additions: Array<{ source: ExtensionChannelNormalizeAdditionSource; text: string }>
    truncated: boolean
  }>
}

export type ExtensionChannelNormalizer = (input: ExtensionChannelNormalizeMessagesRequest) =>
  ExtensionChannelNormalizeMessagesResult | Promise<ExtensionChannelNormalizeMessagesResult>
