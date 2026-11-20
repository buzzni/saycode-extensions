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
  ExtensionManifest,
  ExtensionPermission,
  JsonValue,
  SaycodeExtension,
  SessionOpenBeforeHandler,
  SessionOpenBeforeInput,
  SessionOpenBeforeResult,
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
  /**
   * Calls a dynamic session hook's handler like Desktop does at session open, and rejects a result Desktop would void
   * (an undeclared or secret env name, an undeclared server, an unknown key, a non-string or oversized value).
   */
  openSessionBefore(hookId: string, input: SessionOpenBeforeInput): Promise<SessionOpenBeforeResult>
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
  /**
   * The parsed manifest. Session hooks are checked against it, as Desktop does: only a hook declared `dynamic` may
   * register a handler, and its result may only use that hook's declared names. Without it `sessionHooks` refuses.
   */
  manifest?: ExtensionManifest
}

const MAX_SESSION_HOOK_VALUE = 8192
const SESSION_KINDS = new Set(['chat', 'child', 'automation', 'channel'])
const SHORT_TEXT = /^[^\u0000-\u001f]{1,200}$/

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key))
}

function shortText(value: unknown): value is string {
  return typeof value === 'string' && SHORT_TEXT.test(value)
}

/**
 * Mirrors Desktop src/domain/extensionLaunchInjection.ts `parseSessionOpenBeforeInput`: Core never sends anything else,
 * so a test that passes something else would exercise a handler with input it can never receive. Returns a fresh copy.
 */
function parseSessionOpenBeforeInput(value: unknown): SessionOpenBeforeInput {
  const invalid = (): never => { throw new Error('invalid session.openBefore input') }
  if (!plainObject(value) || !onlyKeys(value, ['reason', 'sessionKind', 'agent', 'project'])) return invalid()
  if ((value.reason !== 'create' && value.reason !== 'resume') || !SESSION_KINDS.has(String(value.sessionKind)) || !shortText(value.agent)) invalid()
  const project = value.project
  if (!plainObject(project) || !onlyKeys(project, ['id', 'companyId', 'repository']) || !shortText(project.id)
    || (project.companyId !== undefined && !shortText(project.companyId))) return invalid()
  const repository = project.repository
  if (repository !== undefined && (!plainObject(repository) || !onlyKeys(repository, ['name', 'remoteHost']) || !shortText(repository.name)
    || (repository.remoteHost !== undefined && !shortText(repository.remoteHost)))) invalid()
  const typed = project as SessionOpenBeforeInput['project']
  return {
    reason: value.reason as SessionOpenBeforeInput['reason'],
    sessionKind: value.sessionKind as SessionOpenBeforeInput['sessionKind'],
    agent: value.agent as string,
    project: {
      id: typed.id,
      ...(typed.companyId ? { companyId: typed.companyId } : {}),
      ...(typed.repository ? { repository: { name: typed.repository.name, ...(typed.repository.remoteHost ? { remoteHost: typed.repository.remoteHost } : {}) } } : {}),
    },
  }
}

/** Mirrors Desktop's host wire check: a result must be JSON (no undefined, function, non-finite number, cycle or class instance). */
function assertJsonValue(value: unknown, path: string, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} must be a finite number`)
    return
  }
  if (typeof value !== 'object') throw new Error(`${path} contains ${typeof value}`)
  if (ancestors.has(value)) throw new Error(`${path} contains a cycle`)
  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      value.forEach((item, index) => assertJsonValue(item, `${path}[${index}]`, ancestors))
      return
    }
    if (!plainObject(value)) throw new Error(`${path} must be a plain object`)
    for (const [key, item] of Object.entries(value)) assertJsonValue(item, `${path}.${key}`, ancestors)
  } finally {
    ancestors.delete(value)
  }
}

/** Mirrors Desktop src/domain/extensionLaunchInjection.ts `readDynamicResult`: anything it would void throws here. */
function checkSessionOpenBeforeResult(manifest: ExtensionManifest, hookId: string, value: unknown): SessionOpenBeforeResult {
  const hook = manifest.contributes.sessionHooks?.find((candidate) => candidate.id === hookId)
  const invalid = (detail: string): never => { throw new Error(`session hook ${hookId} result would be dropped: ${detail}`) }
  if (!hook) return invalid('hook is not declared')
  // Desktop refuses a result that does not survive the JSON host wire before it reads any field.
  try { assertJsonValue(value, 'result') } catch (error) { return invalid((error as Error).message) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid('expected an object')
  const result = value as Record<string, unknown>
  // Count the unknown keys rather than testing `find`'s result: an empty-string key is falsy but still unknown.
  const unknown = Object.keys(result).filter((key) => key !== 'env' && key !== 'mcpServers')
  if (unknown.length > 0) invalid(`unknown key ${JSON.stringify(unknown[0])}`)
  const plain = new Set((hook.env ?? []).filter((item) => !item.secret).map((item) => item.name))
  const env: Record<string, string> = {}
  if (result.env !== undefined) {
    if (!result.env || typeof result.env !== 'object' || Array.isArray(result.env)) invalid('env must be an object')
    for (const [name, item] of Object.entries(result.env as Record<string, unknown>)) {
      if (!plain.has(name)) invalid(`env ${name} is not a declared non-secret name`)
      if (typeof item !== 'string' || item.length > MAX_SESSION_HOOK_VALUE || item.includes('\u0000')) invalid(`env ${name} must be a string up to ${MAX_SESSION_HOOK_VALUE} characters without NUL`)
      env[name] = item as string
    }
  }
  if (result.mcpServers === undefined) return result.env === undefined ? {} : { env }
  const declared = new Set((hook.mcpServers ?? []).map((server) => server.name))
  if (!Array.isArray(result.mcpServers) || result.mcpServers.some((name) => typeof name !== 'string' || !declared.has(name))) {
    invalid('mcpServers must list declared server names')
  }
  return { ...(result.env === undefined ? {} : { env }), mcpServers: [...result.mcpServers as string[]] }
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
  const sessionOpenHandlers = new Map<string, SessionOpenBeforeHandler>()
  let active: SaycodeExtension | null = null
  return {
    async activate(extension) {
      if (active) throw new Error('test host already has an active extension')
      const registered = new Map<string, ExtensionCommandHandler>()
      const registeredChannels = new Map<string, ExtensionChannelHandler>()
      const registeredFormatters = new Map<string, ExtensionChannelReplyFormatter>()
      const registeredIntake = new Map<string, ExtensionChannelIntakeHandler>()
      const registeredNormalizers = new Map<string, ExtensionChannelNormalizer>()
      const registeredSessionHooks = new Map<string, SessionOpenBeforeHandler>()
      let activating = true
      try {
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
          sessionHooks: {
            onOpenBefore(hookId, handler) {
              const declared = options.manifest?.contributes.sessionHooks?.some((hook) => hook.id === hookId && hook.dynamic)
              if (!activating || !declared || typeof handler !== 'function' || registeredSessionHooks.has(hookId)) {
                throw new Error('session hook must be a declared dynamic hook and registered once during activate')
              }
              registeredSessionHooks.set(hookId, handler)
            },
          },
        })
      } finally {
        activating = false
      }
      for (const [id, handler] of registered) commands.set(id, handler)
      for (const [id, handler] of registeredChannels) channels.set(id, handler)
      for (const [id, formatter] of registeredFormatters) formatters.set(id, formatter)
      for (const [id, handler] of registeredIntake) intakeHandlers.set(id, handler)
      for (const [id, normalizer] of registeredNormalizers) normalizers.set(id, normalizer)
      for (const [id, handler] of registeredSessionHooks) sessionOpenHandlers.set(id, handler)
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
    async openSessionBefore(hookId, input) {
      if (!active || !options.manifest) throw new Error('test host is not active')
      const handler = sessionOpenHandlers.get(hookId)
      if (!handler) throw new Error('session hook handler is not registered')
      const parsed = parseSessionOpenBeforeInput(input)
      return checkSessionOpenBeforeResult(options.manifest, hookId, await handler(Object.freeze(parsed)))
    },
    async deactivate() {
      const extension = active
      active = null
      commands.clear()
      channels.clear()
      formatters.clear()
      intakeHandlers.clear()
      normalizers.clear()
      sessionOpenHandlers.clear()
      await extension?.deactivate?.()
    },
  }
}
