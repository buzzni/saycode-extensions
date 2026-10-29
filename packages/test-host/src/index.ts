import type {
  ExtensionCommandHandler,
  ExtensionChannelHandler,
  ExtensionChannelIntake,
  ExtensionChannelIntakeHandler,
  ExtensionChannelLifecycle,
  ExtensionChannelNormalizeMessagesRequest,
  ExtensionChannelNormalizeMessagesResult,
  ExtensionChannelNormalizer,
  ExtensionChannelReplyFormatter,
  ExtensionChannelReplyFormatRequest,
  ExtensionChannelReplyFormatResult,
  ExtensionPermission,
  JsonValue,
  SaycodeExtension,
} from '@buzzni/saycode-extension-sdk'
import { checkNormalizeResult, throughWire } from './channelNormalize.js'

export { fakeSlackHistory, type FakeSlackHistoryOptions, type FakeSlackMessage } from './channelNormalize.js'

export interface ExtensionTestHost {
  activate(extension: SaycodeExtension): Promise<void>
  invokeCommand(id: string, args: JsonValue[]): Promise<JsonValue>
  deliverChannelLifecycle(event: ExtensionChannelLifecycle): Promise<void>
  /** Sends an intake hint; a no-op when the extension registered no `onIntake` handler. */
  deliverIntake(event: ExtensionChannelIntake): Promise<void>
  formatChannelReply(input: ExtensionChannelReplyFormatRequest): Promise<ExtensionChannelReplyFormatResult>
  /** Rejects a result Core's strict parser would discard as a whole (contracts §5.2 rules 1–2). */
  normalizeChannelMessages(input: ExtensionChannelNormalizeMessagesRequest): Promise<ExtensionChannelNormalizeMessagesResult>
  deactivate(): Promise<void>
}

export interface ExtensionTestHostOptions {
  invokeCapability?(
    permission: ExtensionPermission,
    action: string,
    args: JsonValue,
  ): Promise<JsonValue>
  /** `false` imitates a Desktop that predates intake hints: the context has no `onIntake`. */
  intake?: boolean
}

export function createTestHost(
  extensionId: string,
  options: ExtensionTestHostOptions = {},
): ExtensionTestHost {
  const commands = new Map<string, ExtensionCommandHandler>()
  const channels = new Map<string, ExtensionChannelHandler>()
  const formatters = new Map<string, ExtensionChannelReplyFormatter>()
  const intakeHandlers = new Map<string, ExtensionChannelIntakeHandler>()
  const normalizers = new Map<string, ExtensionChannelNormalizer>()
  let active: SaycodeExtension | null = null
  return {
    async activate(extension) {
      if (active) throw new Error('test host already has an active extension')
      const registered = new Map<string, ExtensionCommandHandler>()
      const registeredChannels = new Map<string, ExtensionChannelHandler>()
      const registeredFormatters = new Map<string, ExtensionChannelReplyFormatter>()
      const registeredIntake = new Map<string, ExtensionChannelIntakeHandler>()
      const registeredNormalizers = new Map<string, ExtensionChannelNormalizer>()
      await extension.activate({
        extensionId,
        invokeCapability(permission, action, args) {
          if (!options.invokeCapability) {
            return Promise.reject(new Error(`capability is unavailable: ${permission}`))
          }
          return options.invokeCapability(permission, action, args)
        },
        channels: {
          register(id, handler) {
            if (!id.startsWith(`${extensionId}.`) || registeredChannels.has(id) || typeof handler !== 'function') {
              throw new Error('channel must be namespaced and registered once')
            }
            registeredChannels.set(id, handler)
          },
          registerFormatter(id, formatter) {
            if (!id.startsWith(`${extensionId}.`) || registeredFormatters.has(id) || typeof formatter !== 'function') {
              throw new Error('formatter must be namespaced and registered once')
            }
            registeredFormatters.set(id, formatter)
          },
          ...(options.intake === false ? {} : {
            onIntake(id: string, handler: ExtensionChannelIntakeHandler) {
              if (!id.startsWith(`${extensionId}.`) || registeredIntake.has(id) || typeof handler !== 'function') {
                throw new Error('intake handler must be namespaced and registered once')
              }
              registeredIntake.set(id, handler)
            },
          }),
          registerNormalizer(id, normalizer) {
            if (!id.startsWith(`${extensionId}.`) || registeredNormalizers.has(id) || typeof normalizer !== 'function') {
              throw new Error('normalizer must be namespaced and registered once')
            }
            registeredNormalizers.set(id, normalizer)
          },
        },
        commands: {
          register(id, handler) {
            if (!id.startsWith(`${extensionId}.`)) throw new Error(`command must be namespaced by ${extensionId}`)
            if (registered.has(id)) throw new Error(`duplicate command: ${id}`)
            registered.set(id, handler)
          },
        },
      })
      for (const [id, handler] of registered) commands.set(id, handler)
      for (const [id, handler] of registeredChannels) channels.set(id, handler)
      for (const [id, formatter] of registeredFormatters) formatters.set(id, formatter)
      for (const [id, handler] of registeredIntake) intakeHandlers.set(id, handler)
      for (const [id, normalizer] of registeredNormalizers) normalizers.set(id, normalizer)
      active = extension
    },
    async invokeCommand(id, args) {
      const handler = commands.get(id)
      if (!handler) throw new Error(`command is not registered: ${id}`)
      return await handler(...args)
    },
    async deliverChannelLifecycle(event) {
      if (!active) throw new Error('test host is not active')
      const handler = channels.get(event.channelId)
      if (!handler) throw new Error('channel is not registered')
      await handler(Object.freeze({ ...event }))
    },
    async deliverIntake(event) {
      if (!active) throw new Error('test host is not active')
      await intakeHandlers.get(event.channelId)?.(Object.freeze({ ...event }))
    },
    async formatChannelReply(input) {
      if (!active) throw new Error('test host is not active')
      const formatter = formatters.get(input.channelId)
      if (!formatter) throw new Error('channel formatter is not registered')
      return formatter(Object.freeze({ ...input }))
    },
    async normalizeChannelMessages(input) {
      if (!active) throw new Error('test host is not active')
      const normalizer = normalizers.get(input.channelId)
      // The id comes from the request; only a registered function is ever called with it.
      if (typeof normalizer !== 'function') throw new Error('channel normalizer is not registered')
      return checkNormalizeResult(throughWire(await normalizer(Object.freeze(throughWire(input)))), input)
    },
    async deactivate() {
      const extension = active
      active = null
      commands.clear()
      channels.clear()
      formatters.clear()
      intakeHandlers.clear()
      normalizers.clear()
      await extension?.deactivate?.()
    },
  }
}
