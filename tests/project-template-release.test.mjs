import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('..', import.meta.url)

test('release gate verifies, packs, checksums, and publishes the official project templates', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')

  assert.match(packageJson.scripts['verify:project-templates'], /verify-project-templates\.mjs/)
  assert.match(packageJson.scripts['package:project-templates'], /project-templates.*pack/)
  assert.match(workflow, /npm run verify:project-templates/)
  assert.match(workflow, /npm run package:project-templates/)
  assert.match(workflow, /buzzni\.project-templates-1\.0\.0\.saycode-extension\.sha256/)
  assert.match(workflow, /packages\/project-templates\/buzzni\.project-templates-1\.0\.0\.saycode-extension/)
})

test('release gate packs, checksums, and publishes the official Plugin Manager', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const pluginPackage = JSON.parse(await readFile(new URL('packages/plugin-manager/package.json', root), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('packages/plugin-manager/extension.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:plugin-manager'], /plugin-manager.*pack/)
  assert.equal(manifest.version, '1.0.2')
  assert.equal(pluginPackage.version, manifest.version)
  assert.match(workflow, /npm run package:plugin-manager/)
  assert.match(workflow, new RegExp(`${archive.replaceAll('.', '\\.')}\\.sha256`))
  assert.match(workflow, new RegExp(`packages/plugin-manager/${archive.replaceAll('.', '\\.')}`))
})

test('release gate packs, checksums, and publishes the official Artifact Publisher', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const artifactPublisherPackage = JSON.parse(
    await readFile(new URL('packages/artifact-publisher/package.json', root), 'utf8'),
  )
  const manifest = JSON.parse(
    await readFile(new URL('packages/artifact-publisher/extension.json', root), 'utf8'),
  )
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:artifact-publisher'], /artifact-publisher.*pack/)
  assert.equal(artifactPublisherPackage.version, manifest.version)
  assert.equal(manifest.apiVersion, 3)
  assert.match(workflow, /npm run package:artifact-publisher/)
  assert.match(workflow, new RegExp(`${archive.replaceAll('.', '\\.')}\\.sha256`))
  assert.match(workflow, new RegExp(`packages/artifact-publisher/${archive.replaceAll('.', '\\.')}`))
})
