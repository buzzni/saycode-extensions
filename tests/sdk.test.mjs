import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const exec = promisify(execFile)

test('manifest parser rejects unknown APIs and unsafe paths', () => {
  const manifest = {
    id: 'buzzni.test', version: '1.0.0', apiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [],
    activationEvents: [], contributes: {},
  }
  assert.equal(parseExtensionManifest(manifest, { supportedApiVersion: 1 }).id, 'buzzni.test')
  assert.throws(() => parseExtensionManifest({ ...manifest, apiVersion: 2 }, { supportedApiVersion: 1 }), /unsupported/i)
  assert.throws(() => parseExtensionManifest({ ...manifest, entrypoint: '../index.js' }, { supportedApiVersion: 1 }), /entrypoint/i)
})

test('manifest parser accepts additive project-template metadata and the previous minimal shape', () => {
  const base = {
    id: 'buzzni.templates', version: '1.0.0', apiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
  }
  const complete = parseExtensionManifest({
    ...base,
    contributes: {
      projectTemplates: [{
        id: 'buzzni.templates.dashboard', title: 'Dashboard', description: 'Dashboard starter',
        stack: 'React', firstPrompt: 'Build a dashboard', devServerCommand: 'npm run dev',
        assetsRoot: 'templates/dashboard',
        localizations: { ko: { title: '대시보드', description: '대시보드 시작점', firstPrompt: '대시보드를 만들어줘' } },
      }],
    },
  }, { supportedApiVersion: 1 })
  const previous = parseExtensionManifest({
    ...base,
    contributes: { projectTemplates: [{ id: 'buzzni.templates.legacy', title: 'Legacy', assetsRoot: 'templates/legacy' }] },
  }, { supportedApiVersion: 1 })

  assert.equal(complete.contributes.projectTemplates[0].localizations.ko.title, '대시보드')
  assert.deepEqual(previous.contributes.projectTemplates[0], {
    id: 'buzzni.templates.legacy', title: 'Legacy', assetsRoot: 'templates/legacy',
  })
})

test('manifest command panelId must name a panel declared by the same extension', () => {
  const base = {
    id: 'buzzni.test', version: '1.0.0', apiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [], activationEvents: [],
  }
  const manifest = {
    ...base,
    contributes: {
      commands: [{ id: 'buzzni.test.open', title: 'Open', panelId: 'buzzni.test.panel' }],
      panels: [{ id: 'buzzni.test.panel', title: 'Panel', entrypoint: 'panel.html' }],
    },
  }

  assert.deepEqual(
    parseExtensionManifest(manifest, { supportedApiVersion: 1 }).contributes.commands,
    manifest.contributes.commands,
  )
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      ...manifest.contributes,
      commands: [{ id: 'buzzni.test.open', title: 'Open', panelId: 'other.panel' }],
    },
  }, { supportedApiVersion: 1 }), /panelId/)
})

test('manifest parser supports v2 machine actions while keeping v1 fail-closed', () => {
  const manifest = {
    id: 'buzzni.viewer', version: '1.0.0', apiVersion: 2,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js',
    permissions: ['browserViewer.open'], activationEvents: ['onCommand:buzzni.viewer.open'],
    contributes: {
      commands: [{ id: 'buzzni.viewer.open', title: 'Open' }],
      machineActions: [{
        id: 'buzzni.viewer.action', title: 'Viewer', command: 'buzzni.viewer.open', when: { online: true },
      }],
    },
  }
  assert.deepEqual(
    parseExtensionManifest(manifest, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }).contributes.machineActions,
    manifest.contributes.machineActions,
  )
  assert.throws(() => parseExtensionManifest(
    { ...manifest, apiVersion: 1 },
    { supportedApiVersion: 2, minimumSupportedApiVersion: 1 },
  ), /require.*Extension API version 2/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      ...manifest.contributes,
      machineActions: [{
        id: 'buzzni.viewer.open', title: 'Viewer', command: 'buzzni.viewer.open', when: { online: true },
      }],
    },
  }, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }), /duplicate contribution id/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      ...manifest.contributes,
      machineActions: [{
        id: 'other.viewer.action', title: 'Viewer', command: 'buzzni.viewer.open', when: { online: true },
      }],
    },
  }, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }), /machineActions.*id/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    permissions: ['browserViewer.open', 'browserViewer.open'],
  }, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }), /duplicate permission/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      ...manifest.contributes,
      machineActions: [{
        ...manifest.contributes.machineActions[0],
        platform: 'linux',
      }],
    },
  }, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }), /machineActions.*unknown field/)
})

test('manifest parser supports v3 declarative artifact actions while keeping v2 fail-closed', () => {
  const manifest = {
    id: 'buzzni.artifact-publisher', version: '1.0.0', apiVersion: 3,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js',
    permissions: ['artifacts.publishPublic'], activationEvents: [],
    contributes: {
      artifactActions: [{
        id: 'buzzni.artifact-publisher.publish-public',
        title: 'Create public link',
        localizations: {
          ko: { title: '공개 링크 만들기' },
          ja: { title: '公開リンクを作成' },
          zh: { title: '创建公开链接' },
        },
        operation: 'publishPublic',
        when: {
          sourceTypes: ['project-file', 'personal-chat-file'],
          extensions: ['html', 'htm'],
        },
      }],
    },
  }
  assert.deepEqual(
    parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
      .contributes.artifactActions,
    manifest.contributes.artifactActions,
  )
  assert.throws(() => parseExtensionManifest(
    { ...manifest, apiVersion: 2 },
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2 },
  ), /require.*Extension API version 3/)
  assert.throws(() => parseExtensionManifest(
    { ...manifest, permissions: [] },
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2 },
  ), /artifacts\.publishPublic/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      artifactActions: [{
        ...manifest.contributes.artifactActions[0],
        when: { sourceTypes: ['project-file'], extensions: ['.html'] },
      }],
    },
  }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /extensions/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      artifactActions: [{
        ...manifest.contributes.artifactActions[0],
        id: 'other.extension.publish-public',
      }],
    },
  }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /artifactActions.*id/)
  assert.throws(() => parseExtensionManifest({
    ...manifest,
    contributes: {
      artifactActions: [{
        ...manifest.contributes.artifactActions[0],
        when: {
          sourceTypes: ['project-file'],
          extensions: Array.from({ length: 17 }, (_, index) => `html${index}`),
        },
      }],
    },
  }, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }), /extensions/)
})

test('packed SDK installs and exposes only documented entrypoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saycode-sdk-pack-'))
  try {
    const packageJson = JSON.parse(await readFile(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(packageJson.exports).sort(), ['.', './manifest'])
    const sdkRoot = new URL('../packages/sdk', import.meta.url).pathname
    const { stdout } = await exec('npm', ['pack', sdkRoot, '--pack-destination', directory, '--json'])
    const [{ filename }] = JSON.parse(stdout)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    await exec('npm', ['install', join(directory, filename)], { cwd: directory })
    await exec('node', ['--input-type=module', '-e', "import { defineExtension } from '@buzzni/saycode-extension-sdk'; if (!defineExtension) process.exit(1)"], { cwd: directory })
    await assert.rejects(
      exec('node', ['--input-type=module', '-e', "import '@buzzni/saycode-extension-sdk/internal'"], { cwd: directory }),
      /not defined by "exports"|ERR_PACKAGE_PATH_NOT_EXPORTED/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

const CHANNEL_HOST = { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 1 }

function channelManifest(overrides = {}) {
  return {
    id: 'buzzni.telegram', version: '1.0.0', apiVersion: 3, channelApiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js',
    permissions: ['channels.receive', 'channels.ack', 'channels.send'],
    activationEvents: [],
    contributes: { channels: [{ id: 'buzzni.telegram.adapter', provider: 'telegram' }] },
    ...overrides,
  }
}

test('manifest parser accepts a channel adapter under API 3 + channelApiVersion 1', () => {
  const parsed = parseExtensionManifest(channelManifest(), CHANNEL_HOST)
  assert.equal(parsed.channelApiVersion, 1)
  assert.deepEqual(parsed.contributes.channels, [{ id: 'buzzni.telegram.adapter', provider: 'telegram' }])
  assert.ok(parsed.permissions.includes('channels.receive'))
})

test('channel support is additive: manifests without it parse exactly as before', () => {
  // The whole point of a separate axis. An extension that never heard of channels must not start
  // failing because the host grew a channel contract.
  const parsed = parseExtensionManifest({
    id: 'buzzni.plain', version: '1.0.0', apiVersion: 2,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: ['projects.read'],
    activationEvents: [], contributes: { commands: [{ id: 'buzzni.plain.run', title: 'Run' }] },
  }, CHANNEL_HOST)
  assert.equal(parsed.channelApiVersion, undefined)
  assert.equal(parsed.contributes.channels, undefined)
})

test('channel fields require both Extension API 3 and channelApiVersion', () => {
  assert.throws(
    () => parseExtensionManifest(channelManifest({ apiVersion: 2 }), CHANNEL_HOST),
    /Extension API version 3/,
  )
  const { channelApiVersion: _dropped, ...withoutChannelApi } = channelManifest()
  assert.throws(() => parseExtensionManifest(withoutChannelApi, CHANNEL_HOST), /channelApiVersion/)
  assert.throws(
    () => parseExtensionManifest(channelManifest({ channelApiVersion: 2 }), CHANNEL_HOST),
    /manifest\.channelApiVersion: unsupported 2/,
  )
})

test('session control and approval are separate permissions, never implied by an adapter', () => {
  // A transport adapter that can receive and ack must not thereby be able to drive a session or
  // approve a tool call: those are declared, reviewable permissions of their own.
  const parsed = parseExtensionManifest(channelManifest({
    permissions: ['channels.receive', 'sessions.read'],
  }), CHANNEL_HOST)
  assert.deepEqual(parsed.permissions, ['channels.receive', 'sessions.read'])
  assert.ok(!parsed.permissions.includes('sessions.control'))
  assert.ok(!parsed.permissions.includes('sessions.approveOnce'))

  const elevated = parseExtensionManifest(channelManifest({
    permissions: ['channels.receive', 'sessions.control', 'sessions.approveOnce'],
  }), CHANNEL_HOST)
  assert.ok(elevated.permissions.includes('sessions.approveOnce'))
})

test('a channel permission with no adapter to exercise it is refused', () => {
  assert.throws(
    () => parseExtensionManifest(channelManifest({ contributes: {} }), CHANNEL_HOST),
    /requires a channels contribution/,
  )
})

test('a channel adapter must declare that it can receive', () => {
  assert.throws(
    () => parseExtensionManifest(channelManifest({ permissions: ['channels.send'] }), CHANNEL_HOST),
    /requires the channels\.receive permission/,
  )
})

test('channel entries are strict, bounded and one per provider', () => {
  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: { channels: [{ id: 'buzzni.telegram.adapter', provider: 'irc' }] },
  }), CHANNEL_HOST), /provider: unsupported/)

  // No endpoints, selectors or display strings may ride in on an adapter entry.
  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: { channels: [{ id: 'buzzni.telegram.adapter', provider: 'telegram', endpoint: 'https://evil.example' }] },
  }), CHANNEL_HOST), /unknown field endpoint/)

  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: {
      channels: [
        { id: 'buzzni.telegram.a', provider: 'telegram' },
        { id: 'buzzni.telegram.b', provider: 'telegram' },
      ],
    },
  }), CHANNEL_HOST), /duplicate provider/)

  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: { channels: [] },
  }), CHANNEL_HOST), /between 1 and 8/)
})

test('a channel adapter id collides with any other contribution id', () => {
  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: {
      commands: [{ id: 'buzzni.telegram.adapter', title: 'Adapter' }],
      channels: [{ id: 'buzzni.telegram.adapter', provider: 'telegram' }],
    },
  }), CHANNEL_HOST), /duplicate contribution id/)
})

test('a channel adapter may only claim an id inside its own extension namespace', () => {
  // Otherwise an artifact could declare `buzzni.other.adapter` and claim another extension's slot.
  assert.throws(() => parseExtensionManifest(channelManifest({
    contributes: { channels: [{ id: 'buzzni.someoneelse.adapter', provider: 'telegram' }] },
  }), CHANNEL_HOST), /expected an id declared by the same extension/)
})

test('channelApiVersion is itself gated on Extension API 3', () => {
  // Declaring a contract the host would never let this manifest speak reads as true and behaves
  // as false, so the declaration is refused rather than quietly ignored.
  assert.throws(() => parseExtensionManifest({
    id: 'buzzni.plain', version: '1.0.0', apiVersion: 2, channelApiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [],
    activationEvents: [], contributes: {},
  }, CHANNEL_HOST), /manifest\.channelApiVersion: requires Extension API version 3/)
})

// ---- declarative per-channel commands (P3: Discord Application Command registration) -----------

function discordChannelManifest(commands) {
  return channelManifest({
    id: 'buzzni.discord',
    permissions: ['channels.receive', 'channels.ack', 'channels.send', 'sessions.control'],
    contributes: {
      channels: [{ id: 'buzzni.discord.bot', provider: 'discord', commands }],
    },
  })
}

const SEVEN_COMMANDS = [
  { id: 'pair', description: 'Claim a pairing code', options: [{ name: 'code', description: 'Pairing code', required: true }] },
  { id: 'projects', description: 'List accessible Saycode projects' },
  {
    id: 'new', description: 'Start a new session',
    options: [
      { name: 'project', description: 'Project id or name', required: true },
      { name: 'agent', description: 'Agent override', required: false },
      { name: 'model', description: 'Model override', required: false },
      { name: 'effort', description: 'Effort override', required: false },
    ],
  },
  { id: 'use', description: 'Select an existing session', options: [{ name: 'session_id', description: 'Session id', required: true }] },
  { id: 'status', description: 'Show current session status' },
  { id: 'stop', description: 'Stop the running turn' },
  { id: 'prompt', description: 'Continue the selected session', options: [{ name: 'text', description: 'Prompt text', required: true }] },
]

test('a channel adapter may declare structured commands for provider-native registration', () => {
  const parsed = parseExtensionManifest(discordChannelManifest(SEVEN_COMMANDS), CHANNEL_HOST)
  assert.equal(parsed.contributes.channels.length, 1)
  assert.deepEqual(parsed.contributes.channels[0].commands, SEVEN_COMMANDS)
})

test('old channel artifacts without commands parse exactly as before', () => {
  // The whole point of a separate, optional field. An adapter written before this existed must not
  // start failing because the host grew provider-native command registration.
  const parsed = parseExtensionManifest(channelManifest(), CHANNEL_HOST)
  assert.equal(parsed.contributes.channels[0].commands, undefined)
})

test('declared commands are strict, bounded and unique per channel', () => {
  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{ id: 'new', description: 'x' }, { id: 'new', description: 'y' }]),
    CHANNEL_HOST,
  ), /duplicate command id/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{ id: 'new', description: 'x', endpoint: 'https://evil.example' }]),
    CHANNEL_HOST,
  ), /unknown field endpoint/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{ id: 'new', description: 'x'.repeat(101) }]),
    CHANNEL_HOST,
  ), /description: exceeds 100 characters/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest(Array.from({ length: 21 }, (_, index) => ({ id: `cmd${index}`, description: 'x' }))),
    CHANNEL_HOST,
  ), /at most 20 commands/)
})

test('declared command options are strict, bounded and unique per command', () => {
  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: [{ name: 'project', description: 'a', required: true }, { name: 'project', description: 'b', required: false }],
    }]),
    CHANNEL_HOST,
  ), /duplicate option name/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: [{ name: 'project', description: 'a', required: 'yes' }],
    }]),
    CHANNEL_HOST,
  ), /options\[0\]\.required: expected boolean/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: [{ name: 'Project Name', description: 'a', required: true }],
    }]),
    CHANNEL_HOST,
  ), /invalid identifier/)

  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: Array.from({ length: 26 }, (_, index) => ({ name: `opt${index}`, description: 'x', required: false })),
    }]),
    CHANNEL_HOST,
  ), /at most 25 options/)
})

test('a required option declared after an optional one is refused — Discord\'s own registration call requires required-first', () => {
  assert.throws(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: [
        { name: 'agent', description: 'a', required: false },
        { name: 'project', description: 'b', required: true },
      ],
    }]),
    CHANNEL_HOST,
  ), /a required option must not follow an optional one/)

  // Required-first, optional-after is exactly the accepted (and registrable) order.
  assert.doesNotThrow(() => parseExtensionManifest(
    discordChannelManifest([{
      id: 'new', description: 'x',
      options: [
        { name: 'project', description: 'a', required: true },
        { name: 'agent', description: 'b', required: false },
      ],
    }]),
    CHANNEL_HOST,
  ))
})

test('each of pair/use/prompt/new declares exactly the option set the P3 contract needs, not just a matching name list', () => {
  // A name-only check would have missed the actual functional gap root found: `pair` declared
  // with zero options, leaving a Discord user nowhere to type the pairing code.
  const parsed = parseExtensionManifest(discordChannelManifest(SEVEN_COMMANDS), CHANNEL_HOST)
  const byId = Object.fromEntries(parsed.contributes.channels[0].commands.map((command) => [command.id, command]))
  assert.deepEqual(byId.pair.options, [{ name: 'code', description: 'Pairing code', required: true }])
  assert.deepEqual(byId.use.options, [{ name: 'session_id', description: 'Session id', required: true }])
  assert.deepEqual(byId.prompt.options, [{ name: 'text', description: 'Prompt text', required: true }])
  assert.deepEqual(byId.new.options, [
    { name: 'project', description: 'Project id or name', required: true },
    { name: 'agent', description: 'Agent override', required: false },
    { name: 'model', description: 'Model override', required: false },
    { name: 'effort', description: 'Effort override', required: false },
  ])
  // The three zero-argument commands must not have grown one by accident.
  assert.equal(byId.projects.options, undefined)
  assert.equal(byId.status.options, undefined)
  assert.equal(byId.stop.options, undefined)
})
