import { defineExtension } from '@buzzni/saycode-extension-sdk'
import type { ExtensionChannelLifecycle, ExtensionChannelReplyFormatRequest } from '@buzzni/saycode-extension-sdk'

import { formatTelegramReply } from './reply.js'
import { createTelegramPollRuntime, type TelegramPollRuntime } from './pollLoop.js'

/** Must equal the `channels` contribution id in `extension.json`. */
export const TELEGRAM_CHANNEL_ID = 'buzzni.telegram.bot'

export default defineExtension({
  activate(context) {
    const runtimes = new Map<string, TelegramPollRuntime>()

    context.channels.register(TELEGRAM_CHANNEL_ID, (event: ExtensionChannelLifecycle) => {
      if (event.state === 'start') {
        // A `start` for a connection id already running (a reconnect, or a duplicate lifecycle
        // delivery) restarts it under a fresh runtime rather than layering a second poll loop
        // onto the same connection.
        runtimes.get(event.connectionId)?.stop().catch(() => undefined)
        const runtime = createTelegramPollRuntime({
          invokeCapability: context.invokeCapability,
          connectionId: event.connectionId,
        })
        runtimes.set(event.connectionId, runtime)
        runtime.start()
        return
      }
      // `stop`: a connection id this runtime never started for is a no-op, not an error — Core
      // may deliver `stop` for a connection whose `start` this host process never saw.
      const runtime = runtimes.get(event.connectionId)
      runtimes.delete(event.connectionId)
      return runtime?.stop()
    })

    // Reshaping Core's approved text for delivery outside Core is the `channels.send` authority,
    // so Desktop's host manager requires that permission to register a formatter at all — even
    // though this extension never calls `channels.send` itself (see `pollLoop.ts`).
    context.channels.registerFormatter(TELEGRAM_CHANNEL_ID, (input: ExtensionChannelReplyFormatRequest) =>
      formatTelegramReply(input))
  },
})
