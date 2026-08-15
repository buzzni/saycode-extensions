import type {
  ExtensionCommandHandler,
  JsonValue,
  SaycodeExtension,
} from '@buzzni/saycode-extension-sdk'

export interface ExtensionTestHost {
  activate(extension: SaycodeExtension): Promise<void>
  invokeCommand(id: string, args: JsonValue[]): Promise<JsonValue>
  deactivate(): Promise<void>
}

export function createTestHost(extensionId: string): ExtensionTestHost {
  const commands = new Map<string, ExtensionCommandHandler>()
  let active: SaycodeExtension | null = null
  return {
    async activate(extension) {
      if (active) throw new Error('test host already has an active extension')
      active = extension
      await extension.activate({
        extensionId,
        commands: {
          register(id, handler) {
            if (!id.startsWith(`${extensionId}.`)) throw new Error(`command must be namespaced by ${extensionId}`)
            if (commands.has(id)) throw new Error(`duplicate command: ${id}`)
            commands.set(id, handler)
          },
        },
      })
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
