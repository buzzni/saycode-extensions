// Compiled (never run) by tests/sdk.test.mjs: the channel API 2 types an adapter writes against.
// Each `@ts-expect-error` is a misuse the SDK types must keep refusing.
import type {
  ExtensionChannelNormalizeMessagesRequest,
  ExtensionChannelNormalizeMessagesResult,
  ExtensionChannelNormalizer,
  ExtensionChannelRenderedReplyResult,
  ExtensionChannelReplyFormatRequest,
  ExtensionChannelReplyFormatResult,
  ExtensionContext,
  ExtensionSlackMessageProjection,
} from '../../../packages/sdk/dist/index.js'

declare const context: ExtensionContext

const normalizer: ExtensionChannelNormalizer = (input) => ({
  items: input.items.map((item) => ({
    itemRef: item.itemRef,
    additions: item.projection.files?.length ? [{ source: 'files' as const, text: '[첨부: a.png (png, 1 KB)]' }] : [],
    truncated: false,
  })),
})
// Absent on a Desktop below channel API 2, so callers have to check.
context.channels.registerNormalizer?.('buzzni.slack.adapter', normalizer)
// @ts-expect-error -- registerNormalizer may be absent
context.channels.registerNormalizer('buzzni.slack.adapter', normalizer)

const request: ExtensionChannelNormalizeMessagesRequest = {
  apiVersion: 2, channelId: 'buzzni.slack.adapter', connectionId: 'c1', provider: 'slack', connectionRevision: 1,
  requestId: 'n1', purpose: 'threadHistory', userLabels: { U1: 'kim' },
  items: [{
    itemRef: 'i0', primaryText: '배포 순서', maxAdditionsBytes: 6000,
    projection: {
      blocks: [
        { type: 'rich_text', elements: [{ type: 'rich_text_quote', elements: [{ type: 'text', text: '인용' }, { type: 'user', user_id: 'U1' }] }] },
        { type: 'table', rows: [[{ type: 'raw_text', text: 'a' }, { type: 'rich_text', elements: [] }]] },
        { type: 'section', text: { type: 'mrkdwn', text: '*x*' } },
      ],
      attachments: [{ is_share: true, message_blocks: [{ message: { blocks: [{ type: 'header', text: { type: 'plain_text', text: 'h' } }] } }] }],
      files: [{ name: 'a.png', filetype: 'png', size: 1024 }],
    },
  }],
}
// @ts-expect-error -- only Slack speaks the normalize contract
const otherProvider: ExtensionChannelNormalizeMessagesRequest = { ...request, provider: 'telegram' }
// @ts-expect-error -- a projection carries no file URL or id
const fileUrl: ExtensionSlackMessageProjection = { files: [{ name: 'a.png', url_private: 'https://files.slack.com/a' }] }
// @ts-expect-error -- accessories are dropped by Core's projection
const accessory: ExtensionSlackMessageProjection = { blocks: [{ type: 'section', accessory: { type: 'image' } }] }

// @ts-expect-error -- an addition source is a closed set
const badSource: ExtensionChannelNormalizeMessagesResult = { items: [{ itemRef: 'i0', additions: [{ source: 'primary', text: 'x' }], truncated: false }] }

function format(input: ExtensionChannelReplyFormatRequest): ExtensionChannelReplyFormatResult {
  if (input.apiVersion === 2 && input.mode === 'rendered') {
    const rendered: ExtensionChannelRenderedReplyResult = {
      rendered: [{ text: input.text, sourceStart: 0, sourceEnd: input.text.length }],
    }
    return rendered
  }
  if (input.kind === 'approval') {
    const handle: string = input.approval.approvalHandle
    return { chunks: [handle] }
  }
  return { chunks: [input.text] }
}
context.channels.registerFormatter('buzzni.slack.adapter', format)

const v2Status: ExtensionChannelReplyFormatRequest = {
  apiVersion: 2, mode: 'rendered', dialect: 'slack-mrkdwn', channelId: 'buzzni.slack.adapter', connectionId: 'c1',
  provider: 'slack', connectionRevision: 1, requestId: 'r1', kind: 'status', text: 'a', maxChunkUtf16Units: 3000, maxChunks: 64,
}
// @ts-expect-error -- a v1 request has no rendering mode
const v1WithMode: ExtensionChannelReplyFormatRequest = { ...v2Status, apiVersion: 1 }
// @ts-expect-error -- a v2 request names its dialect
const v2WithoutDialect: ExtensionChannelReplyFormatRequest = { ...v2Status, dialect: undefined }
// @ts-expect-error -- rendered chunks and verbatim chunks are different results
const mixed: ExtensionChannelReplyFormatResult = { chunks: ['a'], rendered: [{ text: 'a', sourceStart: 0, sourceEnd: 1 }] }

export { accessory, badSource, fileUrl, mixed, otherProvider, request, v1WithMode, v2WithoutDialect }
