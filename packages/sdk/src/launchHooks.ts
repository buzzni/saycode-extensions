/**
 * Session-open and worktree-create hooks an extension declares (Desktop specs/extension-session-and-worktree-hooks).
 * Mirrors Desktop src/domain/extensionLaunchHooks.ts, which is the source of truth: the same fields, limits, reserved
 * names and error paths, so `saycode-extension validate` refuses what Desktop would refuse at install time.
 *
 * The manifest is the ceiling: env names, MCP launch lines and copy paths are fixed here and approved as written; a
 * dynamic handler may only supply values for declared non-secret names and pick which declared servers to use.
 */
export interface ExtensionSessionHookEnv {
  name: string
  /** The value is entered in Saycode and kept in its secret store; the extension never sees or returns it. */
  secret?: true
}

export type ExtensionSessionHookMcpServer =
  | { name: string; transport: 'stdio'; command: string; args?: string[]; envNames?: string[] }
  | { name: string; transport: 'http'; url: string; headerEnvNames?: Record<string, string> }

export interface ExtensionSessionHookContribution {
  id: string
  event: 'session.open.before'
  scope?: 'all' | 'company'
  /** The handler registered with `context.sessionHooks.onOpenBefore` computes the values each open. */
  dynamic?: true
  env?: ExtensionSessionHookEnv[]
  mcpServers?: ExtensionSessionHookMcpServer[]
}

/** v1 copies Git-ignored files only; a machine command step is a later decision. */
export interface ExtensionWorktreeHookContribution {
  id: string
  event: 'worktree.create.after'
  copyIgnored: string[]
}

export const SESSION_HOOK_ACTIVATION_PREFIX = 'onSessionOpenBefore:'
/** The first Desktop that understands `sessionHooks` and `worktreeHooks`. */
export const LAUNCH_HOOKS_MINIMUM_ENGINE = '1.4.0'
const MAX_HOOKS = 4
const MAX_ENV = 32
const MAX_SERVERS = 8
const MAX_ARGS = 32
const MAX_COPY = 32
const ID = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const SERVER_NAME = /^[a-z][a-z0-9_-]{0,31}$/
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/
const COMMAND = /^[a-z][a-z0-9._-]{0,63}$/
/** Names the agent, Core or the process loader read; an extension may not steer them. */
const RESERVED_ENV = new Set(['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'PWD', 'TMPDIR', 'TERM', 'PORT', 'NODE_OPTIONS', 'NODE_PATH', 'SSH_AUTH_SOCK'])
const RESERVED_ENV_PREFIXES = ['HAPPY_', 'SAYCODE_', 'APLUS_', 'LD_', 'DYLD_', 'GIT_', 'ANTHROPIC_', 'CLAUDE_', 'OPENAI_', 'CODEX_']
/** Core-owned MCP servers (the daemon's own `happy` server and Saycode connectors). */
const RESERVED_SERVER_PREFIXES = ['happy', 'saycode', 'aplus']
/** Shells and indirections: a fixed launch line through one of these is an arbitrary command. */
const UNSUPPORTED_COMMANDS = /^(sh|bash|zsh|fish|dash|ksh|csh|tcsh|cmd|powershell|pwsh|env|xargs|ssh|tmux|screen|osascript|sudo|su|nohup|awk|gawk|eval|exec)$/
const INTERPRETERS = /^(node|nodejs|deno|bun|python|python2|python3|ruby|perl|php)$/
const INLINE_CODE_FLAGS = new Set(['-e', '-E', '-c', '-p', '-r', '--eval', '--print'])

function fail(path: string, detail: string): never {
  throw new Error(`${path}: ${detail}`)
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value as Record<string, unknown>
}

function string(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.trim() !== value || value.length === 0) fail(path, 'expected non-empty trimmed string')
  return value
}

function array(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'expected array')
  return value
}

function stableId(value: unknown, path: string): string {
  const parsed = string(value, path)
  if (!ID.test(parsed) || parsed.includes('..')) fail(path, 'invalid stable identifier')
  return parsed
}

function assertOnlyKeys(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string): void {
  const unknown = Object.keys(value).find((key) => !allowed.has(key))
  if (unknown) fail(path, `unknown field ${unknown}`)
}

function contributionList<T>(value: unknown, path: string, allowedKeys: readonly string[], parse: (entry: Record<string, unknown>, entryPath: string) => T): T[] {
  return array(value, path).map((raw, index) => {
    const entryPath = `${path}[${index}]`
    const entry = record(raw, entryPath)
    assertOnlyKeys(entry, new Set(allowedKeys), entryPath)
    return parse(entry, entryPath)
  })
}

function relativePath(value: unknown, path: string): string {
  const parsed = string(value, path)
  if (parsed.startsWith('/') || parsed.includes('\\') || parsed.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
    fail(path, 'expected safe relative path')
  }
  return parsed
}

export function isReservedLaunchEnvName(name: string): boolean {
  return RESERVED_ENV.has(name) || RESERVED_ENV_PREFIXES.some((prefix) => name.startsWith(prefix))
}

export function isReservedLaunchMcpServerName(name: string): boolean {
  return RESERVED_SERVER_PREFIXES.some((prefix) => name.startsWith(prefix))
}

function bounded<T>(items: T[], max: number, path: string, min = 0): T[] {
  if (items.length < min || items.length > max) fail(path, `expected ${min} to ${max} entries`)
  return items
}

function envName(value: unknown, path: string): string {
  const name = string(value, path)
  if (!ENV_NAME.test(name)) fail(path, 'expected an upper-case environment variable name')
  if (isReservedLaunchEnvName(name)) fail(path, `reserved name ${name}`)
  return name
}

function parseEnv(value: unknown, path: string): ExtensionSessionHookEnv[] {
  return bounded(contributionList(value, path, ['name', 'secret'], (entry, entryPath) => {
    if (entry.secret !== undefined && entry.secret !== true) fail(`${entryPath}.secret`, 'expected true when present')
    return { name: envName(entry.name, `${entryPath}.name`), ...(entry.secret === true ? { secret: true as const } : {}) }
  }), MAX_ENV, path)
}

function parseArgs(command: string, value: unknown, path: string): string[] {
  const args = bounded(array(value, path), MAX_ARGS, path).map((arg, index) => {
    if (typeof arg !== 'string' || arg.length > 512 || arg.includes('\u0000')) fail(`${path}[${index}]`, 'expected a string up to 512 characters')
    return arg
  })
  if (INTERPRETERS.test(command) && args.some((arg) => INLINE_CODE_FLAGS.has(arg) || arg.startsWith('--eval='))) {
    fail(path, 'inline code is not allowed; run a published package or file')
  }
  return args
}

function parseUrl(value: unknown, path: string): string {
  const url = string(value, path)
  let parsed: URL
  try { parsed = new URL(url) } catch { fail(path, 'expected an https URL') }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || url.length > 2048) fail(path, 'expected an https URL without credentials')
  return url
}

function parseServer(entry: Record<string, unknown>, path: string, env: ExtensionSessionHookEnv[]): ExtensionSessionHookMcpServer {
  const name = string(entry.name, `${path}.name`)
  if (!SERVER_NAME.test(name)) fail(`${path}.name`, 'expected a lower-case server name')
  if (isReservedLaunchMcpServerName(name)) fail(`${path}.name`, `reserved name ${name}`)
  const declared = new Set(env.map((item) => item.name))
  if (entry.transport === 'stdio') {
    assertOnlyKeys(entry, new Set(['name', 'transport', 'command', 'args', 'envNames']), path)
    const command = string(entry.command, `${path}.command`)
    if (!COMMAND.test(command) || UNSUPPORTED_COMMANDS.test(command)) fail(`${path}.command`, 'unsupported command')
    const args = entry.args === undefined ? undefined : parseArgs(command, entry.args, `${path}.args`)
    const envNames = entry.envNames === undefined ? undefined : array(entry.envNames, `${path}.envNames`).map((item, index) => {
      const itemName = string(item, `${path}.envNames[${index}]`)
      if (!declared.has(itemName)) fail(`${path}.envNames[${index}]`, 'expected an env name declared by the same hook')
      return itemName
    })
    return { name, transport: 'stdio', command, ...(args ? { args } : {}), ...(envNames ? { envNames } : {}) }
  }
  if (entry.transport === 'http') {
    assertOnlyKeys(entry, new Set(['name', 'transport', 'url', 'headerEnvNames']), path)
    const url = parseUrl(entry.url, `${path}.url`)
    let headerEnvNames: Record<string, string> | undefined
    if (entry.headerEnvNames !== undefined) {
      const headers = Object.entries(record(entry.headerEnvNames, `${path}.headerEnvNames`))
      bounded(headers, MAX_SERVERS, `${path}.headerEnvNames`)
      headerEnvNames = {}
      for (const [header, raw] of headers) {
        const target = string(raw, `${path}.headerEnvNames.${header}`)
        if (!HEADER_NAME.test(header)) fail(`${path}.headerEnvNames`, `invalid header ${header}`)
        // A header usually carries a credential, so its value must come from the Saycode secret store.
        if (!env.some((item) => item.name === target && item.secret)) fail(`${path}.headerEnvNames.${header}`, 'expected a secret env declared by the same hook')
        headerEnvNames[header] = target
      }
    }
    return { name, transport: 'http', url, ...(headerEnvNames ? { headerEnvNames } : {}) }
  }
  fail(`${path}.transport`, 'expected stdio or http')
}

export function parseExtensionSessionHooks(value: unknown, apiVersion: number): ExtensionSessionHookContribution[] {
  const path = 'manifest.contributes.sessionHooks'
  if (apiVersion < 4) fail(path, 'requires Extension API version 4')
  const hooks = contributionList(value, path, ['id', 'event', 'scope', 'dynamic', 'env', 'mcpServers'], (entry, entryPath) => {
    if (entry.event !== 'session.open.before') fail(`${entryPath}.event`, 'expected session.open.before')
    if (entry.scope !== undefined && entry.scope !== 'all' && entry.scope !== 'company') fail(`${entryPath}.scope`, 'expected all or company')
    if (entry.dynamic !== undefined && entry.dynamic !== true) fail(`${entryPath}.dynamic`, 'expected true when present')
    const env = entry.env === undefined ? [] : parseEnv(entry.env, `${entryPath}.env`)
    const servers = entry.mcpServers === undefined ? [] : bounded(contributionList(entry.mcpServers, `${entryPath}.mcpServers`, ['name', 'transport', 'command', 'args', 'envNames', 'url', 'headerEnvNames'],
      (server, serverPath) => parseServer(server, serverPath, env)), MAX_SERVERS, `${entryPath}.mcpServers`)
    if (env.length === 0 && servers.length === 0) fail(entryPath, 'expected env or mcpServers to inject')
    return {
      id: stableId(entry.id, `${entryPath}.id`),
      event: 'session.open.before' as const,
      ...(entry.scope === undefined ? {} : { scope: entry.scope as 'all' | 'company' }),
      ...(entry.dynamic === true ? { dynamic: true as const } : {}),
      ...(entry.env === undefined ? {} : { env }),
      ...(entry.mcpServers === undefined ? {} : { mcpServers: servers }),
    }
  })
  bounded(hooks, MAX_HOOKS, path)
  // Names are unique per extension, so a conflict between two extensions is always between owners.
  const envNames = new Set<string>()
  const serverNames = new Set<string>()
  for (const hook of hooks) {
    for (const item of hook.env ?? []) {
      if (envNames.has(item.name)) fail(path, `duplicate env name ${item.name}`)
      envNames.add(item.name)
    }
    for (const server of hook.mcpServers ?? []) {
      if (serverNames.has(server.name)) fail(path, `duplicate MCP server name ${server.name}`)
      serverNames.add(server.name)
    }
  }
  return hooks
}

export function parseExtensionWorktreeHooks(value: unknown, apiVersion: number): ExtensionWorktreeHookContribution[] {
  const path = 'manifest.contributes.worktreeHooks'
  if (apiVersion < 4) fail(path, 'requires Extension API version 4')
  return bounded(contributionList(value, path, ['id', 'event', 'copyIgnored'], (entry, entryPath) => {
    if (entry.event !== 'worktree.create.after') fail(`${entryPath}.event`, 'expected worktree.create.after')
    const copyIgnored = bounded(array(entry.copyIgnored, `${entryPath}.copyIgnored`), MAX_COPY, `${entryPath}.copyIgnored`, 1).map((raw, index) => {
      const itemPath = `${entryPath}.copyIgnored[${index}]`
      const relative = relativePath(raw, itemPath)
      if (relative.length > 512 || relative.split('/').includes('.git')) fail(itemPath, 'expected a path outside .git')
      return relative
    })
    return { id: stableId(entry.id, `${entryPath}.id`), event: 'worktree.create.after' as const, copyIgnored }
  }), MAX_HOOKS, path)
}

const ENGINE_RANGE = /^(\^|~|>=|<=|>|<)?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/

/**
 * SDK-only guard: a Desktop older than 1.4.0 does not know these contributions, so the declared range must not admit it.
 * Desktop checks the range against its own version instead; a range this accepts always passes there on 1.4.0+.
 */
function assertEngineFloor(engine: string): void {
  const match = ENGINE_RANGE.exec(engine)
  const [floorMajor, floorMinor, floorPatch] = LAUNCH_HOOKS_MINIMUM_ENGINE.split('.').map(Number) as [number, number, number]
  const lowerBounded = match !== null && match[1] !== '<' && match[1] !== '<='
  const base = match ? [Number(match[2]), Number(match[3]), Number(match[4])] : []
  const atLeast = lowerBounded && (base[0]! - floorMajor || base[1]! - floorMinor || base[2]! - floorPatch) >= 0
  if (!atLeast) {
    fail('manifest.engines.saycode', `sessionHooks and worktreeHooks require Saycode >=${LAUNCH_HOOKS_MINIMUM_ENGINE}; declare a range such as ^${LAUNCH_HOOKS_MINIMUM_ENGINE}`)
  }
}

/** Ownership, permission pairing, activation and the engine floor, checked once the whole manifest is parsed. */
export function assertExtensionLaunchHooks(input: {
  extensionId: string
  engine: string
  sessionHooks: readonly ExtensionSessionHookContribution[]
  worktreeHooks: readonly ExtensionWorktreeHookContribution[]
  permissions: readonly string[]
  activationEvents: readonly string[]
}): void {
  const pairs = [
    ['sessionHooks', 'sessions.launchEnvironment', input.sessionHooks],
    ['worktreeHooks', 'worktrees.prepare', input.worktreeHooks],
  ] as const
  for (const [key, permission, hooks] of pairs) {
    // Both directions: a hook without its permission could never run, and a permission without a hook is a grant
    // with nothing for the person to read before approving.
    if (hooks.length > 0 && !input.permissions.includes(permission)) fail(`manifest.contributes.${key}`, `requires ${permission} permission`)
    if (hooks.length === 0 && input.permissions.includes(permission)) fail('manifest.permissions', `${permission} requires a ${key} contribution`)
    for (const [index, hook] of hooks.entries()) {
      if (!hook.id.startsWith(`${input.extensionId}.`)) fail(`manifest.contributes.${key}[${index}].id`, 'expected an id declared by the same extension')
    }
  }
  for (const [index, hook] of input.sessionHooks.entries()) {
    if (hook.dynamic && !input.activationEvents.includes(`${SESSION_HOOK_ACTIVATION_PREFIX}${hook.id}`)) {
      fail(`manifest.contributes.sessionHooks[${index}].dynamic`, `requires activation event ${SESSION_HOOK_ACTIVATION_PREFIX}${hook.id}`)
    }
  }
  if (input.sessionHooks.length > 0 || input.worktreeHooks.length > 0) assertEngineFloor(input.engine)
}
