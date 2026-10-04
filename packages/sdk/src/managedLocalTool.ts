import type { JsonValue } from './index.js'

export interface ManagedToolArtifact {
  url: string; sha256: string; archiveRoot: string; executable: string; executableSha256: string
  appBundle?: string; signingTeamId?: string; existingExecutables: string[]
}
export type ManagedToolInput = { type: 'integer'; min: number; max: number }
  | { type: 'string'; maxLength: number; values?: string[] }
export interface ManagedToolOperation {
  permission: 'inspect' | 'control'; argv: string[]; payload?: JsonValue; inputs?: Record<string, ManagedToolInput>
}
export interface ManagedLocalTool {
  version: 1; id: string; toolVersion: string; platforms: Record<string, ManagedToolArtifact>
  operations: Record<string, ManagedToolOperation>
}
const ID = /^[a-z][a-z0-9.-]{0,127}$/
const HASH = /^[a-f0-9]{64}$/
const NAME = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/
function fail(): never { throw new Error('INVALID_TOOL_DESCRIPTOR') }
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail()
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) { if (Object.keys(value).some(key => !allowed.includes(key))) fail() }
function text(value: unknown, limit = 4096): string { if (typeof value !== 'string' || !value || value.length > limit || /[\x00-\x1f]/.test(value)) fail(); return value }
function path(value: unknown): string {
  const parsed = text(value)
  if (parsed.startsWith('/') || parsed.includes('\\') || parsed.includes(':') || parsed.split('/').some(part => !part || part === '..' || part === '.')) fail()
  return parsed
}
// Payload templates are small fixed JSON; bound depth/size so a hostile manifest cannot exhaust the stack.
function boundedPayload(value: unknown, depth: number): boolean {
  if (depth > 8) return false
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return typeof value !== 'string' || (value as string).length <= 4096
  if (Array.isArray(value)) return value.length <= 64 && value.every(item => boundedPayload(item, depth + 1))
  if (typeof value !== 'object') return false
  const entries = Object.entries(value as Record<string, unknown>)
  return entries.length <= 64 && entries.every(([, item]) => boundedPayload(item, depth + 1))
}
export function parseManagedLocalTool(value: unknown, extensionId: string): ManagedLocalTool {
  const root = row(value)
  keys(root, ['version', 'id', 'toolVersion', 'platforms', 'operations'])
  if (root.version !== 1 || !ID.test(text(root.id)) || !String(root.id).startsWith(extensionId + '.')
    || !/^\d+\.\d+\.\d+$/.test(text(root.toolVersion))) fail()
  const platforms: Record<string, ManagedToolArtifact> = {}
  for (const [platform, raw] of Object.entries(row(root.platforms))) {
    if (!/^(darwin|win32)-(arm64|x64)$/.test(platform)) fail()
    const source = row(raw)
    keys(source, ['url', 'sha256', 'archiveRoot', 'executable', 'executableSha256', 'appBundle', 'signingTeamId', 'existingExecutables'])
    let url: URL
    try { url = new URL(text(source.url)) } catch { fail() }
    if (url.protocol !== 'https:' || url.username || url.password || !/\.(tar\.gz|zip)$/.test(url.pathname)
      || !HASH.test(text(source.sha256)) || !HASH.test(text(source.executableSha256))) fail()
    if (!Array.isArray(source.existingExecutables) || source.existingExecutables.length > 4
      || source.existingExecutables.some(entry => typeof entry !== 'string' || /[\x00-\x1f]/.test(entry)
        || !/^(\/|[A-Za-z]:\\)/.test(entry) || /(^|[\\/])\.\.([\\/]|$)/.test(entry))) fail()
    if (platform.startsWith('darwin') && (!source.appBundle || !/^[A-Z0-9]{10}$/.test(text(source.signingTeamId)))) fail()
    platforms[platform] = { url: url.toString(), sha256: String(source.sha256), archiveRoot: path(source.archiveRoot),
      executable: path(source.executable), executableSha256: String(source.executableSha256), existingExecutables: source.existingExecutables as string[],
      ...(source.appBundle ? { appBundle: path(source.appBundle), signingTeamId: text(source.signingTeamId) } : {}) }
  }
  const operations: Record<string, ManagedToolOperation> = {}
  for (const [name, raw] of Object.entries(row(root.operations))) {
    if (!NAME.test(name)) fail()
    const source = row(raw)
    keys(source, ['permission', 'argv', 'payload', 'inputs'])
    if (!['inspect', 'control'].includes(String(source.permission)) || !Array.isArray(source.argv) || source.argv.length > 16) fail()
    const argv = source.argv.map(arg => {
      const value = text(arg)
      if (value.includes('{{') && value !== '{{json}}') fail()
      return value
    })
    const inputs: Record<string, ManagedToolInput> = {}
    const declared = Object.entries(source.inputs === undefined ? {} : row(source.inputs))
    if (declared.length > 32 || (source.payload !== undefined && !boundedPayload(source.payload, 0))) fail()
    for (const [name, raw] of declared) {
      if (!NAME.test(name) || /^(session|token|secret|password|command|argv|env)$/i.test(name)) fail()
      const input = row(raw)
      if (input.type === 'integer') {
        keys(input, ['type', 'min', 'max'])
        if (!Number.isSafeInteger(input.min) || !Number.isSafeInteger(input.max) || Number(input.min) > Number(input.max)) fail()
        inputs[name] = { type: 'integer', min: Number(input.min), max: Number(input.max) }
      } else if (input.type === 'string') {
        keys(input, ['type', 'maxLength', 'values'])
        if (!Number.isInteger(input.maxLength) || Number(input.maxLength) < 1 || Number(input.maxLength) > 4096
          || (input.values !== undefined && (!Array.isArray(input.values) || !input.values.length || input.values.length > 64
            || input.values.some(item => typeof item !== 'string' || !item || item.length > Number(input.maxLength) || /[\x00-\x1f]/.test(item))))) fail()
        inputs[name] = { type: 'string', maxLength: Number(input.maxLength), ...(input.values ? { values: input.values as string[] } : {}) }
      } else fail()
    }
    const operation: ManagedToolOperation = { permission: source.permission as 'inspect' | 'control', argv, inputs,
      ...(source.payload === undefined ? {} : { payload: source.payload as JsonValue }) }
    if (argv.includes('{{json}}') !== (source.payload !== undefined)) fail()
    // Validate all templates against declared input names before accepting metadata.
    managedToolArguments(operation, Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.type === 'integer' ? input.min : input.values?.[0] ?? 'x'])), 'validated')
    operations[name] = operation
  }
  if (!Object.keys(platforms).length || !Object.keys(operations).length || Object.keys(operations).length > 32) fail()
  return { version: 1, id: String(root.id), toolVersion: String(root.toolVersion), platforms, operations }
}
export function managedToolArguments(operation: ManagedToolOperation, parameters: Record<string, unknown>, session: string): string[] {
  const inputs = operation.inputs ?? {}
  const invalid = () => { throw new Error('INVALID_TOOL_INPUT') }
  if (Object.keys(parameters).some(key => !Object.hasOwn(inputs, key))) invalid()
  for (const [key, schema] of Object.entries(inputs)) {
    const value = parameters[key]
    if (schema.type === 'integer') {
      if (!Number.isSafeInteger(value) || Number(value) < schema.min || Number(value) > schema.max) invalid()
    } else if (typeof value !== 'string' || !value || value.length > schema.maxLength || /[\x00-\x1f]/.test(value)
      || (schema.values && !schema.values.includes(value))) invalid()
  }
  const render = (value: JsonValue): JsonValue => {
    if (Array.isArray(value)) return value.map(render)
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, render(child)]))
    if (typeof value !== 'string') return value
    const exact = value.match(/^\{\{([A-Za-z][A-Za-z0-9_]*)\}\}$/)
    if (exact) {
      if (exact[1]! === 'session') return session
      if (!Object.hasOwn(inputs, exact[1]!)) invalid()
      return parameters[exact[1]!] as JsonValue
    }
    return value.replace(/\{\{([A-Za-z][A-Za-z0-9_]*)\}\}/g, (_, key: string) => {
      if (key === 'session') return session
      if (!Object.hasOwn(inputs, key)) invalid()
      return String(parameters[key])
    })
  }
  const payload = operation.payload === undefined ? undefined : JSON.stringify(render(operation.payload))
  return operation.argv.map(arg => arg === '{{json}}' ? payload! : arg)
}
