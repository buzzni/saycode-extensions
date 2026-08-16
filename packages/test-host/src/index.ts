import type {
  ExtensionCommandHandler,
  ExtensionPermission,
  JsonValue,
  SaycodeExtension,
} from '@buzzni/saycode-extension-sdk'

export interface ExtensionTestHost {
  activate(extension: SaycodeExtension): Promise<void>
  invokeCommand(id: string, args: JsonValue[]): Promise<JsonValue>
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
  let active: SaycodeExtension | null = null
  return {
    async activate(extension) {
      if (active) throw new Error('test host already has an active extension')
      const registered = new Map<string, ExtensionCommandHandler>()
      await extension.activate({
        extensionId,
        invokeCapability(permission, action, args) {
          if (!options.invokeCapability) {
            return Promise.reject(new Error(`capability is unavailable: ${permission}`))
          }
          return options.invokeCapability(permission, action, args)
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
      active = extension
    },
    async invokeCommand(id, args) {
      const handler = commands.get(id)
      if (!handler) throw new Error(`command is not registered: ${id}`)
      return await handler(...args)
    },
    async deactivate() {
      await active?.deactivate?.()
      active = null
      commands.clear()
    },
  }
}
