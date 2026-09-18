export const EXTENSION_PERMISSIONS = [
  'projects.read', 'remoteFiles.read', 'remoteFiles.write', 'machine.execute',
  'network.fetch', 'notifications.show', 'storage.read', 'storage.write',
  'browserViewer.open', 'browserViewer.install', 'browserViewer.installChrome',
  'artifacts.publishPublic',
  // One permission per channel wire method, deliberately not a single `channels.adapter`.
  // A transport adapter needs to receive and ack; being able to *control a session* or to
  // *approve a tool call once* is a different and much larger authority, and a blanket grant
  // would hand both to anything that could merely read messages. The host still enforces each
  // one against the live grant at call time — declaring it here only makes it askable.
  'channels.receive', 'channels.ack', 'channels.send', 'channels.transport',
  'sessions.read', 'sessions.control', 'sessions.approveOnce',
] as const

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number]
export interface ExtensionCommandContribution { id: string; title: string; panelId?: string }
export interface ExtensionSettingContribution { id: string; title: string; type: 'boolean' | 'number' | 'string' }
export interface ExtensionPanelContribution { id: string; title: string; entrypoint: string }
export interface ExtensionMachineActionContribution {
  id: string
  title: string
  command: string
  when: { online: true }
}
export interface ExtensionArtifactActionContribution {
  id: string
  title: string
  localizations?: Record<string, { title: string }>
  operation: 'publishPublic'
  when: {
    sourceTypes: Array<'project-file' | 'personal-chat-file'>
    extensions: string[]
  }
}
export interface ExtensionProjectTemplateLocalization {
  title?: string
  description?: string
  firstPrompt?: string
}
export interface ExtensionProjectTemplateContribution {
  id: string
  title: string
  assetsRoot: string
  description?: string
  stack?: string
  firstPrompt?: string
  devServerCommand?: string
  localizations?: Record<string, ExtensionProjectTemplateLocalization>
}
/**
 * One provider-native command this adapter wants registered (Discord Application Commands today).
 * Purely declarative: Core reads this at install/enable time and performs the actual registration
 * call itself with its own stored credential — the extension never sees the endpoint or the token.
 * Every option is a string; there is no `type` field because none of the current commands need
 * anything else, and adding one is a version-gated decision for later, not a default to leave open.
 */
export interface ExtensionChannelCommandOption {
  name: string
  description: string
  required: boolean
}
export interface ExtensionChannelCommandContribution {
  id: string
  description: string
  options?: ExtensionChannelCommandOption[]
}

/**
 * One provider adapter. Deliberately just an id, a provider and its optional command list: no
 * endpoint, no selector, no display string. Everything else about a connection — its name, its
 * credentials, its scope — is Core's, and a field here would be adapter-supplied data reaching a
 * settings screen that the user reads as Core's own.
 */
export interface ExtensionChannelContribution {
  id: string
  provider: 'telegram' | 'slack' | 'discord'
  commands?: ExtensionChannelCommandContribution[]
}
export interface ExtensionContributions {
  commands?: ExtensionCommandContribution[]
  settings?: ExtensionSettingContribution[]
  panels?: ExtensionPanelContribution[]
  projectTemplates?: ExtensionProjectTemplateContribution[]
  machineActions?: ExtensionMachineActionContribution[]
  artifactActions?: ExtensionArtifactActionContribution[]
  channels?: ExtensionChannelContribution[]
}
export interface ExtensionManifest {
  id: string
  version: string
  apiVersion: number
  /**
   * The channel wire contract this extension speaks, independent of `apiVersion`. Absent means
   * the extension declares no channel capability at all — which is every manifest written before
   * this field existed, and they must keep parsing exactly as they did.
   */
  channelApiVersion?: number
  engines: { saycode: string }
  entrypoint: string
  permissions: ExtensionPermission[]
  activationEvents: string[]
  contributes: ExtensionContributions
}

const ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
/**
 * Discord's own command/option name charset (lowercase, digits, underscore; no dots) is narrower
 * than `ID` above, which allows dots for namespaced extension ids. Reusing `ID` here would accept
 * a name the real registration call rejects.
 */
const COMMAND_WORD = /^[a-z][a-z0-9_]{0,31}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/
const LOCALE = /^[a-z]{2,3}(?:-[A-Z]{2})?$/
const PERMISSIONS = new Set<string>(EXTENSION_PERMISSIONS)
const ARTIFACT_EXTENSION = /^[a-z0-9]+$/

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`)
  return value as Record<string, unknown>
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`${path}: expected string`)
  return value
}

function optionalText(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : text(value, path)
}

function bool(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`${path}: expected boolean`)
  return value
}

function boundedText(value: unknown, path: string, max: number): string {
  const parsed = text(value, path)
  if ([...parsed].length > max) throw new Error(`${path}: exceeds ${max} characters`)
  return parsed
}

function commandWord(value: unknown, path: string): string {
  const parsed = text(value, path)
  if (!COMMAND_WORD.test(parsed)) throw new Error(`${path}: invalid identifier`)
  return parsed
}

function stableId(value: unknown, path: string): string {
  const parsed = text(value, path)
  if (!ID.test(parsed) || parsed.includes('..')) throw new Error(`${path}: invalid identifier`)
  return parsed
}

function safePath(value: unknown, path: string): string {
  const parsed = text(value, path)
  if (parsed.startsWith('/') || parsed.includes('\\') || parsed.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`${path}: unsafe relative path`)
  }
  return parsed
}

function list(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected array`)
  return value
}

function contributionBase(value: unknown, path: string): { id: string; title: string } {
  const item = record(value, path)
  return { id: stableId(item.id, `${path}.id`), title: text(item.title, `${path}.title`) }
}

function uniqueStrings(value: unknown, path: string, parse: (item: unknown, itemPath: string) => string): string[] {
  const values = list(value, path).map((item, index) => parse(item, `${path}[${index}]`))
  if (values.length === 0 || new Set(values).size !== values.length) {
    throw new Error(`${path}: expected a non-empty unique list`)
  }
  return values
}

const CHANNEL_PROVIDERS = new Set(['telegram', 'slack', 'discord'])
/** Channel-scoped permissions, in the order the wire contract defines them. */
const CHANNEL_PERMISSIONS = new Set<string>([
  'channels.receive', 'channels.ack', 'channels.send', 'channels.transport',
  'sessions.read', 'sessions.control', 'sessions.approveOnce',
])

/**
 * Discord's own documented limits (25 options, 100-char description) are reused as the bounds
 * here rather than invented ones: a manifest this parser accepts must still be one the real
 * registration call accepts.
 */
function parseChannelCommandOptions(value: unknown, path: string): ExtensionChannelCommandOption[] {
  const entries = list(value, path)
  if (entries.length > 25) throw new Error(`${path}: expected at most 25 options`)
  const names = new Set<string>()
  // Discord's registration call itself rejects a required option declared after an optional one
  // (its options array must be required-first). Refusing that order here, at declaration time,
  // means an accepted manifest is always one Core can actually register — never a shape Core would
  // have to silently reorder (which would let the declared order stop matching what registers).
  let sawOptional = false
  return entries.map((item, index) => {
    const optionPath = `${path}[${index}]`
    const source = record(item, optionPath)
    const allowed = new Set(['name', 'description', 'required'])
    const extra = Object.keys(source).find((key) => !allowed.has(key))
    if (extra) throw new Error(`${optionPath}: unknown field ${extra}`)
    const name = commandWord(source.name, `${optionPath}.name`)
    if (names.has(name)) throw new Error(`${path}: duplicate option name ${name}`)
    names.add(name)
    const required = bool(source.required, `${optionPath}.required`)
    if (required && sawOptional) {
      throw new Error(`${optionPath}: a required option must not follow an optional one`)
    }
    if (!required) sawOptional = true
    return {
      name,
      description: boundedText(source.description, `${optionPath}.description`, 100),
      required,
    }
  })
}

function parseChannelCommands(value: unknown, path: string): ExtensionChannelCommandContribution[] {
  const entries = list(value, path)
  if (entries.length > 20) throw new Error(`${path}: expected at most 20 commands`)
  const ids = new Set<string>()
  return entries.map((item, index) => {
    const commandPath = `${path}[${index}]`
    const source = record(item, commandPath)
    const allowed = new Set(['id', 'description', 'options'])
    const extra = Object.keys(source).find((key) => !allowed.has(key))
    if (extra) throw new Error(`${commandPath}: unknown field ${extra}`)
    const id = commandWord(source.id, `${commandPath}.id`)
    if (ids.has(id)) throw new Error(`${path}: duplicate command id ${id}`)
    ids.add(id)
    const options = source.options === undefined
      ? undefined
      : parseChannelCommandOptions(source.options, `${commandPath}.options`)
    return {
      id,
      description: boundedText(source.description, `${commandPath}.description`, 100),
      ...(options ? { options } : {}),
    }
  })
}

function parseChannels(value: unknown): ExtensionChannelContribution[] {
  const entries = list(value, 'channels')
  if (entries.length === 0 || entries.length > 8) {
    throw new Error('channels: expected between 1 and 8 adapters')
  }
  const providers = new Set<string>()
  return entries.map((item, index) => {
    const path = `channels[${index}]`
    const source = record(item, path)
    const allowed = new Set(['id', 'provider', 'commands'])
    const extra = Object.keys(source).find((key) => !allowed.has(key))
    if (extra) throw new Error(`${path}: unknown field ${extra}`)
    const provider = text(source.provider, `${path}.provider`)
    if (!CHANNEL_PROVIDERS.has(provider)) throw new Error(`${path}.provider: unsupported`)
    // One adapter per provider: two entries claiming `telegram` leave the host with no way to say
    // which one a received message belongs to.
    if (providers.has(provider)) throw new Error('channels: duplicate provider')
    providers.add(provider)
    const commands = source.commands === undefined
      ? undefined
      : parseChannelCommands(source.commands, `${path}.commands`)
    return {
      id: stableId(source.id, `${path}.id`),
      provider: provider as ExtensionChannelContribution['provider'],
      ...(commands ? { commands } : {}),
    }
  })
}

function parseArtifactActions(value: unknown): ExtensionArtifactActionContribution[] {
  const actions = list(value, 'artifactActions')
  if (actions.length > 32) throw new Error('artifactActions: expected at most 32 actions')
  return actions.map((item, index) => {
    const path = `artifactActions[${index}]`
    const source = record(item, path)
    const allowed = new Set(['id', 'title', 'localizations', 'operation', 'when'])
    const unknown = Object.keys(source).find((key) => !allowed.has(key))
    if (unknown) throw new Error(`${path}: unknown field ${unknown}`)
    const base = contributionBase(source, path)
    if ([...base.title].length > 120) throw new Error(`${path}.title: exceeds 120 characters`)
    if (source.operation !== 'publishPublic') throw new Error(`${path}.operation: unsupported`)
    const when = record(source.when, `${path}.when`)
    if (Object.keys(when).sort().join(',') !== 'extensions,sourceTypes') {
      throw new Error(`${path}.when: expected sourceTypes and extensions`)
    }
    const sourceTypes = uniqueStrings(when.sourceTypes, `${path}.when.sourceTypes`, (item, itemPath) => {
      if (item !== 'project-file' && item !== 'personal-chat-file') throw new Error(`${itemPath}: unsupported source type`)
      return item
    }) as Array<'project-file' | 'personal-chat-file'>
    const extensions = uniqueStrings(when.extensions, `${path}.when.extensions`, (item, itemPath) => {
      const extension = text(item, itemPath)
      if (!ARTIFACT_EXTENSION.test(extension)) throw new Error(`${itemPath}: expected lowercase extension without a dot`)
      return extension
    })
    if (extensions.length > 16) throw new Error(`${path}.when.extensions: expected at most 16 extensions`)
    let localizations: Record<string, { title: string }> | undefined
    if (source.localizations !== undefined) {
      localizations = {}
      const entries = Object.entries(record(source.localizations, `${path}.localizations`))
      if (entries.length > 16) throw new Error(`${path}.localizations: too many locales`)
      for (const [locale, localizedValue] of entries) {
        if (!LOCALE.test(locale)) throw new Error(`${path}.localizations: invalid locale ${locale}`)
        const localized = record(localizedValue, `${path}.localizations.${locale}`)
        if (Object.keys(localized).join(',') !== 'title') throw new Error(`${path}.localizations.${locale}: expected only title`)
        const title = text(localized.title, `${path}.localizations.${locale}.title`)
        if ([...title].length > 120) throw new Error(`${path}.localizations.${locale}.title: exceeds 120 characters`)
        localizations[locale] = { title }
      }
    }
    return {
      ...base,
      ...(localizations ? { localizations } : {}),
      operation: 'publishPublic',
      when: { sourceTypes, extensions },
    }
  })
}

/**
 * Parsed on its own axis, with the same one-version window `apiVersion` uses: a host may accept at
 * most the current channel contract and the one before it, so a manifest can never be written
 * against a contract two steps away from what the host actually implements.
 */
function parseChannelApiVersion(
  value: unknown,
  apiVersion: number,
  options: { supportedChannelApiVersion?: number; minimumSupportedChannelApiVersion?: number },
): number | undefined {
  const supported = options.supportedChannelApiVersion ?? 1
  const minimum = options.minimumSupportedChannelApiVersion ?? supported
  if (supported - minimum > 1) throw new Error('manifest.channelApiVersion: unsupported host window')
  if (value === undefined) return undefined
  // Gated on the declaration itself, not only on what it unlocks: accepting it under API 2 while
  // refusing every use would let a manifest claim a contract the host would never let it speak.
  if (apiVersion < 3) throw new Error('manifest.channelApiVersion: requires Extension API version 3')
  if (
    typeof value !== 'number'
    || !Number.isInteger(value)
    || value < minimum
    || value > supported
  ) throw new Error(`manifest.channelApiVersion: unsupported ${String(value)}`)
  return value
}

export function parseExtensionManifest(
  value: unknown,
  options: {
    supportedApiVersion: number
    minimumSupportedApiVersion?: number
    supportedChannelApiVersion?: number
    minimumSupportedChannelApiVersion?: number
  },
): ExtensionManifest {
  const raw = record(value, 'manifest')
  const minimum = options.minimumSupportedApiVersion ?? options.supportedApiVersion
  if (
    typeof raw.apiVersion !== 'number'
    || !Number.isInteger(raw.apiVersion)
    || raw.apiVersion < minimum
    || raw.apiVersion > options.supportedApiVersion
    || options.supportedApiVersion - minimum > 1
  ) throw new Error(`manifest.apiVersion: unsupported ${String(raw.apiVersion)}`)
  const apiVersion = raw.apiVersion
  const channelApiVersion = parseChannelApiVersion(raw.channelApiVersion, apiVersion, options)
  const version = text(raw.version, 'manifest.version')
  if (!SEMVER.test(version)) throw new Error('manifest.version: expected semantic version')
  const engines = record(raw.engines, 'manifest.engines')
  const permissions = list(raw.permissions, 'manifest.permissions').map((item, index) => {
    const permission = text(item, `manifest.permissions[${index}]`)
    if (!PERMISSIONS.has(permission)) throw new Error(`manifest.permissions: unknown ${permission}`)
    if (apiVersion < 2 && permission.startsWith('browserViewer.')) {
      throw new Error('manifest.permissions: browserViewer permissions require Extension API version 2')
    }
    if (apiVersion < 3 && permission === 'artifacts.publishPublic') {
      throw new Error('manifest.permissions: artifacts.publishPublic requires Extension API version 3')
    }
    if (CHANNEL_PERMISSIONS.has(permission)) {
      if (apiVersion < 3) {
        throw new Error(`manifest.permissions: ${permission} requires Extension API version 3`)
      }
      // Both gates, not either: the channel wire contract moves on its own version, so an API 3
      // manifest that never declared which channel contract it speaks cannot hold one of these.
      if (channelApiVersion === undefined) {
        throw new Error(`manifest.permissions: ${permission} requires manifest.channelApiVersion`)
      }
    }
    return permission as ExtensionPermission
  })
  if (new Set(permissions).size !== permissions.length) {
    throw new Error('manifest.permissions: duplicate permission')
  }
  const contributions = record(raw.contributes, 'manifest.contributes')
  if (apiVersion < 2 && contributions.machineActions !== undefined) {
    throw new Error('manifest.contributes.machineActions: requires Extension API version 2')
  }
  if (apiVersion < 3 && contributions.artifactActions !== undefined) {
    throw new Error('manifest.contributes.artifactActions: requires Extension API version 3')
  }
  if (contributions.channels !== undefined) {
    if (apiVersion < 3) throw new Error('manifest.contributes.channels: requires Extension API version 3')
    if (channelApiVersion === undefined) {
      throw new Error('manifest.contributes.channels: requires manifest.channelApiVersion')
    }
    // An adapter that cannot receive contributes nothing a channel connection can use, so this is
    // the one permission the contribution itself implies rather than a capability to ask for.
    if (!permissions.includes('channels.receive')) {
      throw new Error('manifest.contributes.channels: requires the channels.receive permission')
    }
  }
  // And the converse, which is the half that matters for authority: a channel or session
  // permission with no adapter to exercise it is a grant looking for a caller. Refused, so the
  // permission set a user approves always corresponds to something this extension declared.
  const declaredChannelPermission = permissions.find((permission) => CHANNEL_PERMISSIONS.has(permission))
  if (declaredChannelPermission !== undefined && contributions.channels === undefined) {
    throw new Error(`manifest.permissions: ${declaredChannelPermission} requires a channels contribution`)
  }
  const channels = contributions.channels === undefined ? undefined : parseChannels(contributions.channels)
  const commands = contributions.commands === undefined ? undefined : list(contributions.commands, 'commands').map((item, index) => {
    const path = `commands[${index}]`
    const source = record(item, path)
    return {
      ...contributionBase(item, path),
      ...(source.panelId === undefined ? {} : { panelId: stableId(source.panelId, `${path}.panelId`) }),
    }
  })
  const panels = contributions.panels === undefined ? undefined : list(contributions.panels, 'panels').map((item, index) => {
    const base = contributionBase(item, `panels[${index}]`)
    return { ...base, entrypoint: safePath(record(item, `panels[${index}]`).entrypoint, `panels[${index}].entrypoint`) }
  })
  const machineActions = contributions.machineActions === undefined
    ? undefined
    : list(contributions.machineActions, 'machineActions').map((item, index) => {
      const path = `machineActions[${index}]`
      const source = record(item, path)
      const unknown = Object.keys(source).find((key) => !['id', 'title', 'command', 'when'].includes(key))
      if (unknown) throw new Error(`${path}: unknown field ${unknown}`)
      const when = record(source.when, `${path}.when`)
      if (Object.keys(when).join(',') !== 'online' || when.online !== true) {
        throw new Error(`${path}.when: expected only online:true`)
      }
      return {
        ...contributionBase(item, path),
        command: stableId(source.command, `${path}.command`),
        when: { online: true as const },
      }
    })
  const artifactActions = contributions.artifactActions === undefined
    ? undefined
    : parseArtifactActions(contributions.artifactActions)
  if (artifactActions?.length && !permissions.includes('artifacts.publishPublic')) {
    throw new Error('manifest.contributes.artifactActions: requires artifacts.publishPublic permission')
  }
  for (const [index, action] of (artifactActions ?? []).entries()) {
    if (!action.id.startsWith(`${text(raw.id, 'manifest.id')}.`)) {
      throw new Error(`artifactActions[${index}].id: expected an id declared by the same extension`)
    }
  }
  for (const [index, command] of (commands ?? []).entries()) {
    if (
      command.panelId !== undefined
      && (!command.panelId.startsWith(`${text(raw.id, 'manifest.id')}.`) || !panels?.some((panel) => panel.id === command.panelId))
    ) {
      throw new Error(`commands[${index}].panelId: expected a panel declared by the same extension`)
    }
  }
  for (const [index, action] of (machineActions ?? []).entries()) {
    if (
      !action.id.startsWith(`${text(raw.id, 'manifest.id')}.`)
      || !action.command.startsWith(`${text(raw.id, 'manifest.id')}.`)
      || !commands?.some((command) => command.id === action.command)
    ) throw new Error(`machineActions[${index}].id/command: expected ids declared by the same extension`)
  }
  const settings = contributions.settings === undefined ? undefined : list(contributions.settings, 'settings').map((item, index) => {
    const source = record(item, `settings[${index}]`)
    const type = text(source.type, `settings[${index}].type`)
    if (type !== 'boolean' && type !== 'number' && type !== 'string') throw new Error('settings type is unsupported')
    return { ...contributionBase(item, `settings[${index}]`), type } as ExtensionSettingContribution
  })
  const projectTemplates = contributions.projectTemplates === undefined ? undefined : list(contributions.projectTemplates, 'projectTemplates').map((item, index) => {
    const path = `projectTemplates[${index}]`
    const source = record(item, path)
    const base = contributionBase(item, path)
    let localizations: Record<string, ExtensionProjectTemplateLocalization> | undefined
    if (source.localizations !== undefined) {
      localizations = {}
      for (const [locale, value] of Object.entries(record(source.localizations, `${path}.localizations`))) {
        if (!LOCALE.test(locale)) throw new Error(`${path}.localizations: invalid locale ${locale}`)
        const localizationPath = `${path}.localizations.${locale}`
        const localization = record(value, localizationPath)
        localizations[locale] = {
          ...(optionalText(localization.title, `${localizationPath}.title`) === undefined ? {} : { title: text(localization.title, `${localizationPath}.title`) }),
          ...(optionalText(localization.description, `${localizationPath}.description`) === undefined ? {} : { description: text(localization.description, `${localizationPath}.description`) }),
          ...(optionalText(localization.firstPrompt, `${localizationPath}.firstPrompt`) === undefined ? {} : { firstPrompt: text(localization.firstPrompt, `${localizationPath}.firstPrompt`) }),
        }
      }
    }
    return {
      ...base,
      assetsRoot: safePath(source.assetsRoot, `${path}.assetsRoot`),
      ...(optionalText(source.description, `${path}.description`) === undefined ? {} : { description: text(source.description, `${path}.description`) }),
      ...(optionalText(source.stack, `${path}.stack`) === undefined ? {} : { stack: text(source.stack, `${path}.stack`) }),
      ...(optionalText(source.firstPrompt, `${path}.firstPrompt`) === undefined ? {} : { firstPrompt: text(source.firstPrompt, `${path}.firstPrompt`) }),
      ...(optionalText(source.devServerCommand, `${path}.devServerCommand`) === undefined ? {} : { devServerCommand: text(source.devServerCommand, `${path}.devServerCommand`) }),
      ...(localizations === undefined ? {} : { localizations }),
    }
  })
  const extensionId = stableId(raw.id, 'manifest.id')
  for (const [index, channel] of (channels ?? []).entries()) {
    // A contribution may only name ids inside its own extension's namespace; without this an
    // artifact could declare `someone.else.adapter` and claim another extension's provider slot.
    if (!channel.id.startsWith(`${extensionId}.`)) {
      throw new Error(`channels[${index}].id: expected an id declared by the same extension`)
    }
  }
  for (const [index, action] of (artifactActions ?? []).entries()) {
    if (!action.id.startsWith(`${extensionId}.`)) {
      throw new Error(`artifactActions[${index}].id: expected an id declared by the same extension`)
    }
  }
  const contributionIds = [
    ...(commands ?? []),
    ...(settings ?? []),
    ...(panels ?? []),
    ...(projectTemplates ?? []),
    ...(machineActions ?? []),
    ...(artifactActions ?? []),
    ...(channels ?? []),
  ].map((contribution) => contribution.id)
  if (new Set(contributionIds).size !== contributionIds.length) {
    throw new Error('manifest.contributes: duplicate contribution id')
  }
  return {
    id: extensionId,
    version,
    apiVersion,
    ...(channelApiVersion === undefined ? {} : { channelApiVersion }),
    engines: { saycode: text(engines.saycode, 'manifest.engines.saycode') },
    entrypoint: safePath(raw.entrypoint, 'manifest.entrypoint'),
    permissions,
    activationEvents: list(raw.activationEvents, 'manifest.activationEvents').map((item, index) => text(item, `manifest.activationEvents[${index}]`)),
    contributes: { commands, settings, panels, projectTemplates, machineActions, artifactActions, channels },
  }
}
