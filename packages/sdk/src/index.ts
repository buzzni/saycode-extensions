import type { ExtensionChannelNormalizer } from './channelNormalize.js'
import type { ExtensionPermission } from './manifest.js'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

/** Selected-file capability, scoped to the owning panel and permission lifetime. Never contains source paths or credentials. */
export interface ExtensionFilePreviewDescriptor {
  version: 1
  handle: string
  name: string
  mimeType: string
  sizeBytes: number
  revision: string
  url: string
}

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
/**
 * "Core has queued something for this connection" (Desktop specs/channel-intake-wake). A hint only:
 * no message and no state — read the work through `channels.receive` as usual, and keep polling,
 * because a hint can be missed.
 */
export type ExtensionChannelIntake = Omit<ExtensionChannelLifecycle, 'state'>
export type ExtensionChannelIntakeHandler = (event: ExtensionChannelIntake) => void | Promise<void>

/** Only Core-approved current final/status text; chunk limits count UTF-16 code units. */
interface ChannelReplyFormatBase extends Omit<ExtensionChannelLifecycle, 'state'> {
  requestId: string
  text: string
  maxChunkUtf16Units: number
  maxChunks: number
}
type ChannelReplyFormatKind =
  | { kind: 'final' | 'status'; approval?: never }
  | { kind: 'approval'; approval: { approvalHandle: string; approveLabel: string; denyLabel: string } }
/**
 * Channel API 2 adds a mode. `verbatim` means exactly the v1 request; `rendered` asks for Slack
 * mrkdwn chunks that each say which part of the approved text they show (`ExtensionChannelRenderedReplyResult`).
 */
export type ExtensionChannelReplyFormatRequestV2 = Omit<ChannelReplyFormatBase, 'apiVersion'> & {
  apiVersion: 2
  mode: 'verbatim' | 'rendered'
  dialect: 'slack-mrkdwn'
} & ChannelReplyFormatKind
export type ExtensionChannelReplyFormatRequest =
  | (ChannelReplyFormatBase & ChannelReplyFormatKind & { mode?: never; dialect?: never })
  | ExtensionChannelReplyFormatRequestV2

type SlackApprovalButton = {
  type: 'button'
  action_id: string
  text: { type: 'plain_text'; text: string }
}
type DiscordApprovalButton = { type: 2; style: 3 | 4; label: string; custom_id: string }

/** Core checks every field against its request; arbitrary blocks, URLs and extra actions are refused. */
export type ExtensionChannelApprovalFormatResult = { chunks: readonly [string]; rendered?: never } & (
  | { blocks: readonly [
      { type: 'section'; text: { type: 'plain_text'; text: string } },
      { type: 'actions'; elements: readonly [SlackApprovalButton, SlackApprovalButton] },
    ]; components?: never }
  | { components: readonly [{ type: 1; components: readonly [DiscordApprovalButton, DiscordApprovalButton] }]; blocks?: never }
)
/**
 * One chunk of a `rendered` reply: Slack mrkdwn (at most `maxChunkUtf16Units`) and the half-open
 * UTF-16 range of the approved text it shows. The ranges must tile the whole text in order, and Core
 * checks each chunk shows exactly its range's visible characters, code blocks byte-for-byte after
 * escaping `&`, `<`, `>`, with no `<!`, `<@` or `<#` token — a refused result is sent as plain text.
 */
export interface ExtensionChannelRenderedChunk { text: string; sourceStart: number; sourceEnd: number }
export interface ExtensionChannelRenderedReplyResult {
  rendered: readonly ExtensionChannelRenderedChunk[]
  chunks?: never
  blocks?: never
  components?: never
}
export type ExtensionChannelReplyFormatResult =
  | { chunks: readonly string[]; blocks?: never; components?: never; rendered?: never }
  | ExtensionChannelApprovalFormatResult
  | ExtensionChannelRenderedReplyResult
export type ExtensionChannelReplyFormatter = (input: ExtensionChannelReplyFormatRequest) =>
  ExtensionChannelReplyFormatResult | Promise<ExtensionChannelReplyFormatResult>

export interface ExtensionContext {
  readonly extensionId: string
  /** Register during activate; handlers start/stop bounded background work and return promptly. */
  readonly channels: {
    register(id: string, handler: ExtensionChannelHandler): void
    /** Return nonempty Unicode-safe chunks whose concatenation is exactly the supplied text. */
    registerFormatter(id: string, formatter: ExtensionChannelReplyFormatter): void
    /** Absent on a Desktop that does not send intake hints; check before calling. */
    onIntake?(id: string, handler: ExtensionChannelIntakeHandler): void
    /**
     * Channel API 2: Core calls it with thread history only while `channels.normalize` is declared
     * and approved. Absent on a Desktop below channel API 2; check before calling.
     */
    registerNormalizer?(id: string, normalizer: ExtensionChannelNormalizer): void
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

export type MachineRunStartRequest = {
  action: 'start'
  profileId: string
  parameters: Record<string, JsonValue>
}
export type MachineRunStatusRequest = { action: 'status'; operationId: string }
export type MachineRunCancelRequest = { action: 'cancel'; operationId: string }
export type MachineRunRequest = MachineRunStartRequest | MachineRunStatusRequest | MachineRunCancelRequest
export type MachineRunResult =
  | { action: 'start'; operationId: string; state: 'accepted' }
  | { action: 'status'; operationId: string; state: 'running' | 'passed' | 'failed' | 'cancelled'; stdout?: string; stderr?: string; truncated?: boolean; exitCode?: number | null; timedOut?: boolean; remoteMayContinue?: boolean; descendantsReaped?: boolean; signal?: string; durationMs?: number }
  | { action: 'cancel'; operationId: string; state: 'cancelled' | 'already-terminal'; remoteMayContinue?: boolean; descendantsReaped?: boolean }

/** Why Core refused a `machine.run` call. Additive: an unknown code from a newer host stays an ordinary error. */
export const MACHINE_RUN_ERROR_CODES = [
  'unsupported-daemon', 'invalid-request', 'binding-mismatch', 'declined',
  'approval-timeout', 'workspace-busy', 'tool-missing', 'unsupported-platform',
] as const
export type MachineRunErrorCode = (typeof MACHINE_RUN_ERROR_CODES)[number]

export class MachineRunError extends Error {
  readonly code: MachineRunErrorCode
  constructor(code: MachineRunErrorCode, message?: string) {
    super(message || `machine.run refused: ${code}`)
    this.name = 'MachineRunError'
    this.code = code
  }
}

function refusalCode(error: unknown): MachineRunErrorCode | null {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return MACHINE_RUN_ERROR_CODES.includes(code as MachineRunErrorCode) ? code as MachineRunErrorCode : null
}

/** Rejects with a `MachineRunError` when the host reports a known refusal code; other failures pass through unchanged. */
export async function machineRun(context: ExtensionContext, request: MachineRunRequest): Promise<MachineRunResult> {
  const args: JsonValue = request.action === 'start'
    ? { profileId: request.profileId, parameters: request.parameters }
    : { operationId: request.operationId }
  try {
    return await context.invokeCapability('machine.run', request.action, args) as MachineRunResult
  } catch (error) {
    const code = refusalCode(error)
    if (code === null) throw error
    const message = (error as { message?: unknown }).message
    throw new MachineRunError(code, typeof message === 'string' ? message : undefined)
  }
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
  ExtensionProjectToolContribution,
  ExtensionPanelContribution,
  ExtensionPanelSurfaceSize,
  ExtensionPermission,
  ExtensionProjectTemplateLocalization,
  ExtensionProjectTemplateContribution,
  ExtensionSettingContribution,
  MachineCommandParameter,
  MachineCommandProfile,
  MachineCommandsDeclaration,
} from './manifest.js'

export { CHANNEL_NORMALIZE_ADDITION_SOURCES } from './channelNormalize.js'
export type {
  ExtensionChannelNormalizeAdditionSource,
  ExtensionChannelNormalizeMessagesRequest,
  ExtensionChannelNormalizeMessagesResult,
  ExtensionChannelNormalizer,
  ExtensionSlackBlockProjection,
  ExtensionSlackHttpUrl,
  ExtensionSlackMessageProjection,
  ExtensionSlackRichTextContainer,
  ExtensionSlackRichTextLeaf,
  ExtensionSlackTextObject,
} from './channelNormalize.js'

export type { ManagedLocalTool, ManagedToolArtifact, ManagedToolOperation } from './managedLocalTool.js'
