import { defineExtension } from '@buzzni/saycode-extension-sdk'
import type {
  ExtensionChannelLifecycle,
  ExtensionChannelReplyFormatRequest,
  ExtensionChannelReplyFormatResult,
} from '@buzzni/saycode-extension-sdk'

import { formatSlackApproval } from './approval.js'
import { formatSlackReply } from './reply.js'
import { normalizeSlackMessages } from './normalize.js'
import { createSlackIntakeRuntime, type SlackIntakeRuntime } from './intakeLoop.js'
import { SLACK_RECEIVE_MAX_MS } from './backoff.js'

/** Must equal the `channels` contribution id in `extension.json`. */
export const SLACK_CHANNEL_ID = 'buzzni.slack.bot'

export default defineExtension({
  activate(context) {
    const runtimes = new Map<string, SlackIntakeRuntime>()

    // A Desktop that sends intake hints wakes the loop when Core queues a message, so a quiet
    // connection can ask rarely. An older Desktop has no `onIntake`, and the loop keeps its short
    // idle poll there. Polling stays either way: a hint can be missed.
    const hinted = typeof context.channels.onIntake === 'function'
    context.channels.onIntake?.(SLACK_CHANNEL_ID, (event) => { runtimes.get(event.connectionId)?.hint() })

    context.channels.register(SLACK_CHANNEL_ID, (event: ExtensionChannelLifecycle) => {
      if (event.state === 'start') {
        runtimes.get(event.connectionId)?.stop().catch(() => undefined)
        const runtime = createSlackIntakeRuntime({
          invokeCapability: context.invokeCapability,
          connectionId: event.connectionId,
          ...(hinted ? { idleMaxMs: SLACK_RECEIVE_MAX_MS } : {}),
        })
        runtimes.set(event.connectionId, runtime)
        runtime.start()
        return
      }
      const runtime = runtimes.get(event.connectionId)
      runtimes.delete(event.connectionId)
      return runtime?.stop()
    })

    // Reshaping Core's approved text for delivery outside Core is the `channels.send` authority,
    // so Desktop's host manager requires that permission to register a formatter at all — even
    // though this extension never calls `channels.send` itself (Core's own send path posts via
    // `chat.postMessage`; see `intakeLoop.ts`).
    // Channel API 2: Core sends thread history here only while `channels.normalize` is approved.
    // Absent on a Desktop below channel API 2, which never asks.
    context.channels.registerNormalizer?.(SLACK_CHANNEL_ID, normalizeSlackMessages)

    context.channels.registerFormatter(
      SLACK_CHANNEL_ID,
      (input: ExtensionChannelReplyFormatRequest): ExtensionChannelReplyFormatResult =>
        input.kind === 'approval' ? formatSlackApproval(input) : formatSlackReply(input),
    )
  },
})
