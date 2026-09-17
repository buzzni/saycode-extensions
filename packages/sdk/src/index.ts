import type { ExtensionPermission } from './manifest.js'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export type ExtensionCommandHandler = (...args: JsonValue[]) => JsonValue | Promise<JsonValue>

/** Core-issued context for one declared channel contribution; contains no credentials or account data. */
export interface ExtensionChannelLifecycle {
  apiVersion: 1
  channelId: string
  state: 'start' | 'stop'
  connectionId: string
  provider: 'telegram' | 'slack' | 'discord'
  connectionRevision: number
}
export type ExtensionChannelHandler = (event: ExtensionChannelLifecycle) => void | Promise<void>

/** Only Core-approved current final/status text; chunk limits count UTF-16 code units. */
interface ChannelReplyFormatBase extends Omit<ExtensionChannelLifecycle, 'state'> {
  requestId: string
  text: string
  maxChunkUtf16Units: number
  maxChunks: number
}
export type ExtensionChannelReplyFormatRequest = ChannelReplyFormatBase & (
  | { kind: 'final' | 'status'; approval?: never }
  | { kind: 'approval'; approval: { approvalHandle: string; approveLabel: string; denyLabel: string } }
)

type SlackApprovalButton = {
  type: 'button'
  action_id: string
  text: { type: 'plain_text'; text: string }
}
type DiscordApprovalButton = { type: 2; style: 3 | 4; label: string; custom_id: string }

/** Core checks every field against its request; arbitrary blocks, URLs and extra actions are refused. */
export type ExtensionChannelApprovalFormatResult = { chunks: readonly [string] } & (
  | { blocks: readonly [
      { type: 'section'; text: { type: 'plain_text'; text: string } },
      { type: 'actions'; elements: readonly [SlackApprovalButton, SlackApprovalButton] },
    ]; components?: never }
  | { components: readonly [{ type: 1; components: readonly [DiscordApprovalButton, DiscordApprovalButton] }]; blocks?: never }
)
export type ExtensionChannelReplyFormatResult =
  | { chunks: readonly string[]; blocks?: never; components?: never }
  | ExtensionChannelApprovalFormatResult
export type ExtensionChannelReplyFormatter = (input: ExtensionChannelReplyFormatRequest) =>
  ExtensionChannelReplyFormatResult | Promise<ExtensionChannelReplyFormatResult>

export interface ExtensionContext {
  readonly extensionId: string
  /** Register during activate; handlers start/stop bounded background work and return promptly. */
  readonly channels: {
    register(id: string, handler: ExtensionChannelHandler): void
    /** Return nonempty Unicode-safe chunks whose concatenation is exactly the supplied text. */
    registerFormatter(id: string, formatter: ExtensionChannelReplyFormatter): void
  }
  invokeCapability(permission: ExtensionPermission, action: string, args: JsonValue): Promise<JsonValue>
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
  ExtensionChannelCommandContribution,
  ExtensionChannelCommandOption,
  ExtensionChannelContribution,
  ExtensionCommandContribution,
  ExtensionArtifactActionContribution,
  ExtensionContributions,
  ExtensionManifest,
  ExtensionMachineActionContribution,
  ExtensionPanelContribution,
  ExtensionPermission,
  ExtensionProjectTemplateLocalization,
  ExtensionProjectTemplateContribution,
  ExtensionSettingContribution,
} from './manifest.js'
