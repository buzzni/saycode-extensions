import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import JSZip from 'jszip'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const root = fileURLToPath(new URL('..', import.meta.url))
const packageRoot = join(root, 'packages/artifact-publisher')
const cli = join(root, 'packages/sdk/dist/cli.js')
const exec = promisify(execFile)

test('Artifact Publisher declares only the localized HTML public-link action', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8')),
    { supportedApiVersion: 3, minimumSupportedApiVersion: 2 },
  )

  assert.equal(manifest.id, 'buzzni.artifact-publisher')
  assert.equal(manifest.apiVersion, 3)
  assert.deepEqual(manifest.permissions, ['artifacts.publishPublic'])
  assert.deepEqual(manifest.activationEvents, [])
  assert.deepEqual(manifest.contributes.commands, undefined)
  assert.deepEqual(manifest.contributes.artifactActions, [{
    id: 'buzzni.artifact-publisher.publish-public',
    title: 'Create public link',
    localizations: {
      ko: { title: '공개 링크 만들기' },
      en: { title: 'Create public link' },
      ja: { title: '公開リンクを作成' },
      zh: { title: '创建公开链接' },
    },
    operation: 'publishPublic',
    when: {
      sourceTypes: ['project-file', 'personal-chat-file'],
      extensions: ['html', 'htm'],
    },
  }])
})

test('Artifact Publisher runtime is inert and cannot receive source or publication DTOs', async () => {
  const source = await readFile(join(packageRoot, 'src/index.ts'), 'utf8')
  assert.match(source, /defineExtension/)
  assert.doesNotMatch(source, /invokeCapability|commands\.register|projectId|chatId|publication|publicUrl|path/)
})

test('Artifact Publisher packs as an API v3-only installable archive', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-artifact-publisher-'))
  const archive = join(temporary, 'artifact-publisher.saycode-extension')
  try {
    await exec('node', [cli, 'pack', packageRoot, '--output', archive])
    const zip = await JSZip.loadAsync(await readFile(archive))
    assert.deepEqual(Object.keys(zip.files).sort(), ['extension.json', 'index.js'])

    const manifest = JSON.parse(await zip.file('extension.json').async('string'))
    assert.equal(
      parseExtensionManifest(manifest, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 }).apiVersion,
      3,
    )
    assert.throws(
      () => parseExtensionManifest(manifest, { supportedApiVersion: 2, minimumSupportedApiVersion: 1 }),
      /unsupported/i,
    )
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
