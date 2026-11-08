import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import JSZip from 'jszip'

import { defineExtension } from '../packages/sdk/dist/index.js'
import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'
import { createTestHost } from '../packages/test-host/dist/index.js'

// The accept/reject fixtures below are ported from Desktop tests/extensionLaunchHooks.test.ts, whose parser
// (src/domain/extensionLaunchHooks.ts) is the source of truth. A manifest validate accepts must install there.

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')
const options = { supportedApiVersion: 4, minimumSupportedApiVersion: 2 }
const ext = 'acme.tools'
const sessionHook = {
  id: 'acme.tools.docs',
  event: 'session.open.before',
  env: [{ name: 'ACME_API_URL' }, { name: 'ACME_TOKEN', secret: true }],
  mcpServers: [{ name: 'acme-docs', transport: 'stdio', command: 'npx', args: ['-y', '@acme/docs-mcp'], envNames: ['ACME_TOKEN'] }],
}
const worktreeHook = { id: 'acme.tools.prepare', event: 'worktree.create.after', copyIgnored: ['.env.local', 'config/dev.secrets.json'] }

function manifest(input) {
  const permissions = input.permissions ?? [
    ...(input.sessionHooks ? ['sessions.launchEnvironment'] : []),
    ...(input.worktreeHooks ? ['worktrees.prepare'] : []),
  ]
  return {
    id: ext,
    version: '1.0.0',
    apiVersion: input.apiVersion ?? 4,
    engines: { saycode: input.engine ?? '>=1.4.0' },
    entrypoint: 'index.js',
    permissions,
    activationEvents: input.activationEvents ?? [],
    contributes: {
      ...(input.sessionHooks ? { sessionHooks: input.sessionHooks } : {}),
      ...(input.worktreeHooks ? { worktreeHooks: input.worktreeHooks } : {}),
    },
  }
}

const parse = (value) => parseExtensionManifest(value, options)

test('sessionHooks: keeps a declared hook with env and an MCP server', () => {
  assert.deepEqual(parse(manifest({ sessionHooks: [sessionHook] })).contributes.sessionHooks, [sessionHook])
})

test('sessionHooks: keeps an http server whose header names a secret env', () => {
  const hook = {
    id: 'acme.tools.remote', event: 'session.open.before', scope: 'company',
    env: [{ name: 'ACME_TOKEN', secret: true }],
    mcpServers: [{ name: 'acme-remote', transport: 'http', url: 'https://mcp.acme.test/v1', headerEnvNames: { Authorization: 'ACME_TOKEN' } }],
  }
  assert.deepEqual(parse(manifest({ sessionHooks: [hook] })).contributes.sessionHooks, [hook])
})

const rejectedSessionHooks = [
  ['an unknown field', { ...sessionHook, before: true }, /sessionHooks\[0\].*unknown field before/],
  ['another event', { ...sessionHook, event: 'agent.open.before' }, /sessionHooks\[0\]\.event/],
  ['an id of another extension', { ...sessionHook, id: 'other.ext.docs' }, /sessionHooks\[0\]\.id/],
  ['nothing to inject', { id: 'acme.tools.empty', event: 'session.open.before' }, /sessionHooks\[0\].*env or mcpServers/],
  ['a lower-case env name', { ...sessionHook, env: [{ name: 'acme_url' }] }, /env\[0\]\.name/],
  ['a reserved env name', { ...sessionHook, env: [{ name: 'PATH' }], mcpServers: [] }, /env\[0\]\.name.*reserved/],
  ['a reserved env prefix', { ...sessionHook, env: [{ name: 'HAPPY_SERVER_URL' }], mcpServers: [] }, /reserved/],
  ['an agent credential env', { ...sessionHook, env: [{ name: 'ANTHROPIC_API_KEY' }], mcpServers: [] }, /reserved/],
  ['a repeated env name', { ...sessionHook, env: [{ name: 'ACME_A' }, { name: 'ACME_A' }], mcpServers: [] }, /duplicate env name ACME_A/],
  ['secret other than true', { ...sessionHook, env: [{ name: 'ACME_A', secret: false }], mcpServers: [] }, /secret/],
  ['an upper-case server name', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], name: 'Acme' }] }, /mcpServers\[0\]\.name/],
  ['a reserved server name', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], name: 'happy' }] }, /mcpServers\[0\]\.name.*reserved/],
  ['the daemon\'s computer-control server name', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], name: 'cua-driver' }] }, /mcpServers\[0\]\.name.*reserved name cua-driver/],
  ['a shell command', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'bash' }] }, /command.*unsupported/],
  ['a command path', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: '/usr/bin/node' }] }, /command.*unsupported/],
  ['an inline eval', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'node', args: ['-e', 'x()'] }] }, /args.*inline code/],
  ['an attached inline eval', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'node', args: ['-ex()'] }] }, /inline code/],
  ['a data: loader', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'node', args: ['--import=data:text/javascript,x'] }] }, /inline code/],
  ['a versioned interpreter eval', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'python3.11', args: ['-c', 'x'] }] }, /inline code/],
  ['a runner shell line', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'npx', args: ['-c', 'curl x | sh'] }] }, /inline code/],
  ['a Windows shell', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'cmd.exe' }] }, /command.*unsupported/],
  ['an .exe shell', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], command: 'bash.exe' }] }, /command.*unsupported/],
  ['a shell startup env', { ...sessionHook, env: [{ name: 'BASH_ENV' }], mcpServers: [] }, /reserved/],
  ['an interpreter path env', { ...sessionHook, env: [{ name: 'PYTHONPATH' }], mcpServers: [] }, /reserved/],
  ['a Windows executable lookup env', { ...sessionHook, env: [{ name: 'PATHEXT' }], mcpServers: [] }, /reserved/],
  ['an undeclared env for a server', { ...sessionHook, mcpServers: [{ ...sessionHook.mcpServers[0], envNames: ['OTHER'] }] }, /envNames.*declared/],
  ['a plain http url', { ...sessionHook, mcpServers: [{ name: 'acme-remote', transport: 'http', url: 'http://mcp.acme.test' }] }, /url.*https/],
  ['credentials in the url', { ...sessionHook, mcpServers: [{ name: 'acme-remote', transport: 'http', url: 'https://u:p@mcp.acme.test' }] }, /url/],
  ['a header from a non-secret env', { ...sessionHook, mcpServers: [{ name: 'acme-remote', transport: 'http', url: 'https://mcp.acme.test', headerEnvNames: { Authorization: 'ACME_API_URL' } }] }, /headerEnvNames.*secret/],
  ['a stdio field on http', { ...sessionHook, mcpServers: [{ name: 'acme-remote', transport: 'http', url: 'https://mcp.acme.test', command: 'npx' }] }, /unknown field command/],
  ['an unknown transport', { ...sessionHook, mcpServers: [{ name: 'acme-remote', transport: 'sse', url: 'https://mcp.acme.test' }] }, /transport/],
  ['an unknown scope', { ...sessionHook, scope: 'personal' }, /scope/],
]
for (const [label, hook, expected] of rejectedSessionHooks) {
  test(`sessionHooks: rejects ${label}`, () => {
    assert.throws(() => parse(manifest({ sessionHooks: [hook] })), expected)
  })
}

test('sessionHooks: rejects the same env or server name in two hooks of one extension', () => {
  const second = { id: 'acme.tools.other', event: 'session.open.before', env: [{ name: 'ACME_API_URL' }] }
  assert.throws(() => parse(manifest({ sessionHooks: [sessionHook, second] })), /duplicate env name ACME_API_URL/)
  const third = { id: 'acme.tools.other', event: 'session.open.before', mcpServers: [{ ...sessionHook.mcpServers[0], envNames: [] }] }
  assert.throws(() => parse(manifest({ sessionHooks: [sessionHook, third] })), /duplicate MCP server name acme-docs/)
})

test('sessionHooks: a dynamic hook needs its activation event', () => {
  const dynamic = { ...sessionHook, dynamic: true }
  assert.throws(() => parse(manifest({ sessionHooks: [dynamic] })), /onSessionOpenBefore:acme\.tools\.docs/)
  assert.deepEqual(
    parse(manifest({ sessionHooks: [dynamic], activationEvents: ['onSessionOpenBefore:acme.tools.docs'] })).contributes.sessionHooks,
    [dynamic],
  )
})

test('sessionHooks: the hook and its permission are declared together', () => {
  assert.throws(() => parse(manifest({ sessionHooks: [sessionHook], permissions: [] })), /sessions\.launchEnvironment/)
  assert.throws(() => parse(manifest({ permissions: ['sessions.launchEnvironment'] })), /sessions\.launchEnvironment requires/)
})

test('sessionHooks: requires Extension API version 4', () => {
  assert.throws(() => parse(manifest({ sessionHooks: [sessionHook], apiVersion: 3 })), /requires Extension API version 4/)
  assert.throws(() => parse(manifest({ sessionHooks: [sessionHook], apiVersion: 3, permissions: [] })), /sessionHooks.*requires Extension API version 4/)
})

test('worktreeHooks: keeps a copyIgnored hook', () => {
  assert.deepEqual(parse(manifest({ worktreeHooks: [worktreeHook] })).contributes.worktreeHooks, [worktreeHook])
})

const rejectedWorktreeHooks = [
  ['a machineCommand hook, left for a later version', { ...worktreeHook, machineCommand: 'acme.tools.fetch' }, /unknown field machineCommand/],
  ['an empty copy list', { ...worktreeHook, copyIgnored: [] }, /copyIgnored.*1 to 32/],
  ['a parent path', { ...worktreeHook, copyIgnored: ['../secrets'] }, /copyIgnored\[0\]/],
  ['an absolute path', { ...worktreeHook, copyIgnored: ['/etc/passwd'] }, /copyIgnored\[0\]/],
  ['a path inside .git', { ...worktreeHook, copyIgnored: ['.git/config'] }, /copyIgnored\[0\].*\.git/],
  ['another event', { ...worktreeHook, event: 'worktree.create.before' }, /event/],
]
for (const [label, hook, expected] of rejectedWorktreeHooks) {
  test(`worktreeHooks: rejects ${label}`, () => {
    assert.throws(() => parse(manifest({ worktreeHooks: [hook] })), expected)
  })
}

test('worktreeHooks: the hook and its permission are declared together', () => {
  assert.throws(() => parse(manifest({ worktreeHooks: [worktreeHook], permissions: [] })), /worktrees\.prepare/)
  assert.throws(() => parse(manifest({ permissions: ['worktrees.prepare'] })), /worktrees\.prepare requires/)
})

test('worktreeHooks: a hook id may not repeat another contribution id', () => {
  assert.throws(
    () => parse(manifest({ sessionHooks: [sessionHook], worktreeHooks: [{ ...worktreeHook, id: sessionHook.id }] })),
    /duplicate contribution id/,
  )
})

test('manifests without hooks parse to the same shape as before', () => {
  const parsed = parse(manifest({}))
  assert.equal('sessionHooks' in parsed.contributes, false)
  assert.equal('worktreeHooks' in parsed.contributes, false)
})

test('hooks need an engine range that excludes Desktop builds older than 1.4.0', () => {
  for (const engine of ['>=1.4.0', '^1.4.0', '~1.4.2', '1.5.0', '^2.0.0', '>1.4.0']) {
    assert.doesNotThrow(() => parse(manifest({ worktreeHooks: [worktreeHook], engine })), engine)
  }
  for (const engine of ['^1.0.0', '^1.3.0', '>=1.3.9', '<2.0.0', '<=1.9.0', 'latest']) {
    assert.throws(() => parse(manifest({ sessionHooks: [sessionHook], engine })), /manifest\.engines\.saycode.*1\.4\.0/, engine)
  }
  // Manifests without hooks keep whatever range they had.
  assert.doesNotThrow(() => parse(manifest({ engine: '^1.0.0' })))
})

async function packSample(name) {
  const temporary = await mkdtemp(join(tmpdir(), `saycode-${name}-`))
  const archive = join(temporary, `${name}.saycode-extension`)
  await exec('node', [cli, 'pack', join(root, 'examples', name), '--output', archive])
  const zip = await JSZip.loadAsync(await readFile(archive))
  assert.deepEqual(Object.keys(zip.files).sort(), ['extension.json', 'index.js'])
  const packed = parse(JSON.parse(await zip.file('extension.json').async('string')))
  // The bundle is a browser ESM module; load it the way the isolated host would, without the SDK on disk.
  const modulePath = join(temporary, 'index.mjs')
  await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
  const loaded = await import(pathToFileURL(modulePath).href)
  return { temporary, manifest: packed, extension: loaded.default }
}

test('session-env-sample packs and its dynamic hook fills only its declared non-secret env', async () => {
  const source = parse(JSON.parse(await readFile(join(root, 'examples/session-env-sample/extension.json'), 'utf8')))
  const { temporary, manifest: packed, extension } = await packSample('session-env-sample')
  try {
    assert.deepEqual(packed, source)
    assert.equal(packed.engines.saycode, '^1.4.0')
    assert.deepEqual(packed.permissions, ['sessions.launchEnvironment'])
    const [docs, company] = packed.contributes.sessionHooks
    assert.deepEqual(docs.env, [{ name: 'SAMPLE_DOCS_URL' }, { name: 'SAMPLE_DOCS_TOKEN', secret: true }])
    assert.equal(docs.mcpServers[0].command, 'npx')
    assert.deepEqual(docs.mcpServers[0].envNames, ['SAMPLE_DOCS_TOKEN'])
    assert.equal(company.dynamic, true)

    const host = createTestHost(packed.id, { manifest: packed })
    await host.activate(extension)
    const input = { reason: 'create', sessionKind: 'chat', agent: 'claude', project: { id: 'p1', companyId: 'c42' } }
    assert.deepEqual(await host.openSessionBefore(company.id, input), { env: { SAMPLE_COMPANY_WORKSPACE: 'company-c42' } })
    assert.deepEqual(await host.openSessionBefore(company.id, { ...input, reason: 'resume', project: { id: 'p2' } }), {})
    // The static hook has no handler: Saycode reads its values from what the person entered.
    await assert.rejects(host.openSessionBefore(docs.id, input), /not registered/)
    await host.deactivate()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('worktree-prepare-sample packs a copyIgnored-only hook', async () => {
  const { temporary, manifest: packed, extension } = await packSample('worktree-prepare-sample')
  try {
    assert.equal(packed.engines.saycode, '^1.4.0')
    assert.deepEqual(packed.permissions, ['worktrees.prepare'])
    assert.deepEqual(packed.activationEvents, [])
    assert.deepEqual(packed.contributes.worktreeHooks, [{
      id: 'buzzni.worktree-prepare-sample.env-local', event: 'worktree.create.after', copyIgnored: ['.env.local'],
    }])
    const host = createTestHost(packed.id, { manifest: packed })
    await host.activate(extension)
    await host.deactivate()
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

const hostManifest = parse(manifest({
  sessionHooks: [{ ...sessionHook, dynamic: true }, { id: 'acme.tools.static', event: 'session.open.before', env: [{ name: 'ACME_STATIC' }] }],
  activationEvents: ['onSessionOpenBefore:acme.tools.docs'],
}))
const openInput = { reason: 'create', sessionKind: 'chat', agent: 'codex', project: { id: 'p1' } }

test('test host registers only declared dynamic hooks, once, during activate', async () => {
  const register = (hookId, times = 1) => defineExtension({
    activate(context) {
      for (let index = 0; index < times; index += 1) context.sessionHooks.onOpenBefore(hookId, () => ({}))
    },
  })
  await assert.rejects(createTestHost(ext, { manifest: hostManifest }).activate(register('acme.tools.static')), /declared dynamic hook/)
  await assert.rejects(createTestHost(ext, { manifest: hostManifest }).activate(register('acme.tools.missing')), /declared dynamic hook/)
  await assert.rejects(createTestHost(ext, { manifest: hostManifest }).activate(register('acme.tools.docs', 2)), /registered once/)
  await assert.rejects(createTestHost(ext).activate(register('acme.tools.docs')), /declared dynamic hook/)

  let late
  const host = createTestHost(ext, { manifest: hostManifest })
  await host.activate(defineExtension({ activate(context) { late = context.sessionHooks } }))
  assert.throws(() => late.onOpenBefore('acme.tools.docs', () => ({})), /during activate/)
})

test('test host rejects a handler result Desktop would drop', async () => {
  const run = async (result) => {
    const host = createTestHost(ext, { manifest: hostManifest })
    await host.activate(defineExtension({ activate(context) { context.sessionHooks.onOpenBefore('acme.tools.docs', () => result) } }))
    return host.openSessionBefore('acme.tools.docs', openInput)
  }
  assert.deepEqual(await run({ env: { ACME_API_URL: 'https://docs.acme.test' }, mcpServers: [] }), {
    env: { ACME_API_URL: 'https://docs.acme.test' }, mcpServers: [],
  })
  assert.deepEqual(await run({ mcpServers: ['acme-docs'] }), { mcpServers: ['acme-docs'] })
  await assert.rejects(run({ env: { ACME_TOKEN: 'leaked' } }), /ACME_TOKEN is not a declared non-secret name/)
  await assert.rejects(run({ env: { ACME_STATIC: 'x' } }), /ACME_STATIC is not a declared non-secret name/)
  await assert.rejects(run({ env: { ACME_API_URL: 42 } }), /must be a string/)
  await assert.rejects(run({ env: { ACME_API_URL: 'x'.repeat(8193) } }), /must be a string/)
  await assert.rejects(run({ env: { ACME_API_URL: 'a\u0000b' } }), /without NUL/)
  await assert.rejects(run({ mcpServers: ['other'] }), /declared server names/)
  await assert.rejects(run({ command: 'bash' }), /unknown key "command"/)
  await assert.rejects(run({ '': true }), /unknown key ""/)
  await assert.rejects(run(null), /expected an object/)
  // Not JSON: Desktop's host wire refuses these before reading any field.
  await assert.rejects(run({ env: undefined }), /result\.env contains undefined/)
  await assert.rejects(run({ mcpServers: undefined }), /result\.mcpServers contains undefined/)
  await assert.rejects(run({ env: { ACME_API_URL: () => 'x' } }), /contains function/)
  await assert.rejects(run(new (class Result {})()), /plain object/)
})

test('test host refuses input Core would never send and hands the handler a copy', async () => {
  let received
  const host = createTestHost(ext, { manifest: hostManifest })
  await host.activate(defineExtension({ activate(context) { context.sessionHooks.onOpenBefore('acme.tools.docs', (input) => { received = input; return {} }) } }))
  const input = { reason: 'resume', sessionKind: 'channel', agent: 'claude', project: { id: 'p1', companyId: 'c1', repository: { name: 'repo', remoteHost: 'github.com' } } }
  assert.deepEqual(await host.openSessionBefore('acme.tools.docs', input), {})
  assert.deepEqual(received, input)
  assert.notEqual(received.project, input.project)
  assert.ok(Object.isFrozen(received))
  const rejected = [
    { ...input, extra: true },
    { ...input, reason: 'open' },
    { ...input, sessionKind: 'terminal' },
    { ...input, agent: '' },
    { ...input, agent: 'x'.repeat(201) },
    { ...input, agent: 'a\nb' },
    { ...input, project: { id: 'p1', path: '/Users/me/repo' } },
    { ...input, project: { id: 'p1', companyId: '' } },
    { ...input, project: { id: 'p1', repository: { name: 'repo', url: 'https://github.com/x/y' } } },
    { ...input, project: { id: 'p1', repository: { name: 'repo', remoteHost: 'a\u0001b' } } },
  ]
  for (const value of rejected) {
    await assert.rejects(host.openSessionBefore('acme.tools.docs', value), /invalid session\.openBefore input/, JSON.stringify(value))
  }
})
