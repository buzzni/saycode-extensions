export const EXTENSION_PERMISSIONS = [
  'projects.read', 'remoteFiles.read', 'remoteFiles.write', 'machine.execute',
  'network.fetch', 'notifications.show', 'storage.read', 'storage.write',
  'browserViewer.open', 'browserViewer.install', 'browserViewer.installChrome',
  'artifacts.publishPublic',
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
export interface ExtensionContributions {
  commands?: ExtensionCommandContribution[]
  settings?: ExtensionSettingContribution[]
  panels?: ExtensionPanelContribution[]
  projectTemplates?: ExtensionProjectTemplateContribution[]
  machineActions?: ExtensionMachineActionContribution[]
  artifactActions?: ExtensionArtifactActionContribution[]
}
export interface ExtensionManifest {
  id: string
  version: string
  apiVersion: number
  engines: { saycode: string }
  entrypoint: string
  permissions: ExtensionPermission[]
  activationEvents: string[]
  contributes: ExtensionContributions
}

const ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
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

export function parseExtensionManifest(
  value: unknown,
  options: { supportedApiVersion: number; minimumSupportedApiVersion?: number },
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
  const contributionIds = [
    ...(commands ?? []),
    ...(settings ?? []),
    ...(panels ?? []),
    ...(projectTemplates ?? []),
    ...(machineActions ?? []),
    ...(artifactActions ?? []),
  ].map((contribution) => contribution.id)
  if (new Set(contributionIds).size !== contributionIds.length) {
    throw new Error('manifest.contributes: duplicate contribution id')
  }
  return {
    id: stableId(raw.id, 'manifest.id'),
    version,
    apiVersion,
    engines: { saycode: text(engines.saycode, 'manifest.engines.saycode') },
    entrypoint: safePath(raw.entrypoint, 'manifest.entrypoint'),
    permissions,
    activationEvents: list(raw.activationEvents, 'manifest.activationEvents').map((item, index) => text(item, `manifest.activationEvents[${index}]`)),
    contributes: { commands, settings, panels, projectTemplates, machineActions, artifactActions },
  }
}
