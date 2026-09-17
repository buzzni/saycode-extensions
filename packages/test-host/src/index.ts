import type {
  ExtensionCommandHandler,
  ExtensionChannelHandler,
  ExtensionChannelLifecycle,
  ExtensionChannelReplyFormatter,
  ExtensionChannelReplyFormatRequest,
  ExtensionChannelReplyFormatResult,
  ExtensionPermission,
  JsonValue,
  SaycodeExtension,
} from '@buzzni/saycode-extension-sdk'

export interface ExtensionTestHost {
  activate(extension: SaycodeExtension): Promise<void>
  invokeCommand(id: string, args: JsonValue[]): Promise<JsonValue>
  deliverChannelLifecycle(event: ExtensionChannelLifecycle): Promise<void>
  formatChannelReply(input: ExtensionChannelReplyFormatRequest): Promise<ExtensionChannelReplyFormatResult>
  deactivate(): Promise<void>
}

export interface ExtensionTestHostOptions {
  invokeCapability?(
    permission: ExtensionPermission,
    action: string,
    args: JsonValue,
  ): Promise<JsonValue>
}

export function createTestHost(
  extensionId: string,
  options: ExtensionTestHostOptions = {},
): ExtensionTestHost {
  const commands = new Map<string, ExtensionCommandHandler>()
  const channels = new Map<string, ExtensionChannelHandler>()
  const formatters = new Map<string, ExtensionChannelReplyFormatter>()
  let active: SaycodeExtension | null = null
  return {
    async activate(extension) {
      if (active) throw new Error('test host already has an active extension')
      const registered = new Map<string, ExtensionCommandHandler>()
      const registeredChannels = new Map<string, ExtensionChannelHandler>()
      const registeredFormatters = new Map<string, ExtensionChannelReplyFormatter>()
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
    async formatChannelReply(input) {
      if (!active) throw new Error('test host is not active')
      const formatter = formatters.get(input.channelId)
      if (!formatter) throw new Error('channel formatter is not registered')
      return formatter(Object.freeze({ ...input }))
    },
    async deactivate() {
      const extension = active
      active = null
      commands.clear()
      channels.clear()
      formatters.clear()
      await extension?.deactivate?.()
    },
  }
}
