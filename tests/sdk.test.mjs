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
