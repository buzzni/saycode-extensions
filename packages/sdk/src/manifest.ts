export const EXTENSION_PERMISSIONS = [
  'projects.read', 'remoteFiles.read', 'remoteFiles.write', 'machine.execute',
  'network.fetch', 'notifications.show', 'storage.read', 'storage.write',
] as const

export type ExtensionPermission = (typeof EXTENSION_PERMISSIONS)[number]
export interface ExtensionCommandContribution { id: string; title: string }
export interface ExtensionSettingContribution { id: string; title: string; type: 'boolean' | 'number' | 'string' }
export interface ExtensionPanelContribution { id: string; title: string; entrypoint: string }
export interface ExtensionProjectTemplateContribution { id: string; title: string; assetsRoot: string }
export interface ExtensionContributions {
  commands?: ExtensionCommandContribution[]
  settings?: ExtensionSettingContribution[]
  panels?: ExtensionPanelContribution[]
  projectTemplates?: ExtensionProjectTemplateContribution[]
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
const PERMISSIONS = new Set<string>(EXTENSION_PERMISSIONS)

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${path}: expected object`)
  return value as Record<string, unknown>
}

function text(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value || value.trim() !== value) throw new Error(`${path}: expected string`)
  return value
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

export function parseExtensionManifest(
  value: unknown,
  options: { supportedApiVersion: number },
): ExtensionManifest {
  const raw = record(value, 'manifest')
  if (raw.apiVersion !== options.supportedApiVersion) throw new Error(`manifest.apiVersion: unsupported ${String(raw.apiVersion)}`)
  const version = text(raw.version, 'manifest.version')
  if (!SEMVER.test(version)) throw new Error('manifest.version: expected semantic version')
  const engines = record(raw.engines, 'manifest.engines')
  const permissions = list(raw.permissions, 'manifest.permissions').map((item, index) => {
    const permission = text(item, `manifest.permissions[${index}]`)
    if (!PERMISSIONS.has(permission)) throw new Error(`manifest.permissions: unknown ${permission}`)
    return permission as ExtensionPermission
  })
  const contributions = record(raw.contributes, 'manifest.contributes')
  const commands = contributions.commands === undefined ? undefined : list(contributions.commands, 'commands').map((item, index) => contributionBase(item, `commands[${index}]`))
  const panels = contributions.panels === undefined ? undefined : list(contributions.panels, 'panels').map((item, index) => {
    const base = contributionBase(item, `panels[${index}]`)
    return { ...base, entrypoint: safePath(record(item, `panels[${index}]`).entrypoint, `panels[${index}].entrypoint`) }
  })
  const settings = contributions.settings === undefined ? undefined : list(contributions.settings, 'settings').map((item, index) => {
    const source = record(item, `settings[${index}]`)
    const type = text(source.type, `settings[${index}].type`)
    if (type !== 'boolean' && type !== 'number' && type !== 'string') throw new Error('settings type is unsupported')
    return { ...contributionBase(item, `settings[${index}]`), type } as ExtensionSettingContribution
  })
  const projectTemplates = contributions.projectTemplates === undefined ? undefined : list(contributions.projectTemplates, 'projectTemplates').map((item, index) => {
    const base = contributionBase(item, `projectTemplates[${index}]`)
    return { ...base, assetsRoot: safePath(record(item, `projectTemplates[${index}]`).assetsRoot, `projectTemplates[${index}].assetsRoot`) }
  })
  return {
    id: stableId(raw.id, 'manifest.id'),
    version,
    apiVersion: options.supportedApiVersion,
    engines: { saycode: text(engines.saycode, 'manifest.engines.saycode') },
    entrypoint: safePath(raw.entrypoint, 'manifest.entrypoint'),
    permissions,
    activationEvents: list(raw.activationEvents, 'manifest.activationEvents').map((item, index) => text(item, `manifest.activationEvents[${index}]`)),
    contributes: { commands, settings, panels, projectTemplates },
  }
}
