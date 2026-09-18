import { defineExtension } from '@buzzni/saycode-extension-sdk'
import type {
  ExtensionChannelLifecycle,
  ExtensionChannelReplyFormatRequest,
  ExtensionChannelReplyFormatResult,
} from '@buzzni/saycode-extension-sdk'

import { formatDiscordApproval } from './approval.js'
import { formatDiscordReply } from './reply.js'
import { createDiscordIntakeRuntime, type DiscordIntakeRuntime } from './intakeLoop.js'

/** Must equal the `channels` contribution id in `extension.json`. */
export const DISCORD_CHANNEL_ID = 'buzzni.discord.bot'

export default defineExtension({
  activate(context) {
    const runtimes = new Map<string, DiscordIntakeRuntime>()

    context.channels.register(DISCORD_CHANNEL_ID, (event: ExtensionChannelLifecycle) => {
      if (event.state === 'start') {
        runtimes.get(event.connectionId)?.stop().catch(() => undefined)
        const runtime = createDiscordIntakeRuntime({
          invokeCapability: context.invokeCapability,
          connectionId: event.connectionId,
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
    // `POST /channels/{channelId}/messages`; see `intakeLoop.ts`).
    context.channels.registerFormatter(
      DISCORD_CHANNEL_ID,
      (input: ExtensionChannelReplyFormatRequest): ExtensionChannelReplyFormatResult =>
        input.kind === 'approval' ? formatDiscordApproval(input) : formatDiscordReply(input),
    )
  },
})
