export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ExtensionCommandHandler = (...args: JsonValue[]) => JsonValue | Promise<JsonValue>

export interface ExtensionContext {
  readonly extensionId: string
  readonly commands: {
    register(id: string, handler: ExtensionCommandHandler): void
  }
}

export interface SaycodeExtension {
  activate(context: ExtensionContext): void | Promise<void>
  deactivate?(): void | Promise<void>
}

export function defineExtension(extension: SaycodeExtension): SaycodeExtension {
  return extension
}

export type {
  ExtensionCommandContribution,
  ExtensionContributions,
  ExtensionManifest,
  ExtensionPanelContribution,
  ExtensionPermission,
  ExtensionProjectTemplateContribution,
  ExtensionSettingContribution,
} from './manifest.js'
