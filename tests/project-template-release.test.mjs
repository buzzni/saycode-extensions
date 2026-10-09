import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const root = new URL('..', import.meta.url)

test('release gate publishes the API v2 Hello World fixture under a new immutable version', async () => {
  const packageJson = JSON.parse(await readFile(new URL('examples/hello-world/package.json', root), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('examples/hello-world/extension.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.equal(manifest.version, '1.0.1')
  assert.equal(manifest.apiVersion, 2)
  assert.equal(packageJson.version, manifest.version)
  assert.match(workflow, new RegExp(`${archive.replaceAll('.', '\\.')}\\.sha256`))
  assert.match(workflow, new RegExp(`examples/hello-world/${archive.replaceAll('.', '\\.')}`))
})

test('release gate verifies, packs, checksums, and publishes the official project templates', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const projectTemplatesPackage = JSON.parse(
    await readFile(new URL('packages/project-templates/package.json', root), 'utf8'),
  )
  const manifest = JSON.parse(
    await readFile(new URL('packages/project-templates/extension.json', root), 'utf8'),
  )
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['verify:project-templates'], /verify-project-templates\.mjs/)
  assert.match(packageJson.scripts['package:project-templates'], /project-templates.*pack/)
  assert.equal(manifest.version, '1.0.1')
  assert.equal(manifest.apiVersion, 2)
  assert.equal(projectTemplatesPackage.version, manifest.version)
  assert.match(workflow, /npm run verify:project-templates/)
  assert.match(workflow, /npm run package:project-templates/)
  assert.match(workflow, new RegExp(`${archive.replaceAll('.', '\\.')}\\.sha256`))
  assert.match(workflow, new RegExp(`packages/project-templates/${archive.replaceAll('.', '\\.')}`))
})

test('release gate packs, checksums, and publishes the official Plugin Manager', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const pluginPackage = JSON.parse(await readFile(new URL('packages/plugin-manager/package.json', root), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('packages/plugin-manager/extension.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:plugin-manager'], /plugin-manager.*pack/)
  assert.equal(manifest.version, '1.0.3')
  assert.equal(manifest.apiVersion, 2)
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

test('release gate packs, checksums, and publishes the official Document Templates extension', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const templatesPackage = JSON.parse(
    await readFile(new URL('packages/document-templates/package.json', root), 'utf8'),
  )
  const manifest = JSON.parse(
    await readFile(new URL('packages/document-templates/extension.json', root), 'utf8'),
  )
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:document-templates'], /document-templates.*pack/)
  assert.equal(templatesPackage.version, manifest.version)
  assert.equal(manifest.apiVersion, 3)
  assert.match(workflow, /npm run package:document-templates/)
  // Plain substring checks: the archive name comes from the manifest, so no regular expression is built from it.
  assert.ok(workflow.includes(`${archive}.sha256`))
  assert.ok(workflow.includes(`packages/document-templates/${archive}`))
})

test('release gate packs, checksums, and publishes the official Computer Control extension', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const controlPackage = JSON.parse(await readFile(new URL('packages/computer-control/package.json', root), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('packages/computer-control/extension.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:computer-control'], /computer-control.*pack/)
  assert.equal(controlPackage.version, manifest.version)
  assert.equal(manifest.apiVersion, 3)
  assert.match(workflow, /npm run package:computer-control/)
  // Plain substring checks: the archive name comes from the manifest, so no regular expression is built from it.
  assert.ok(workflow.includes(`${archive}.sha256`))
  assert.ok(workflow.includes(`packages/computer-control/${archive}`))
})

test('release gate packs, checksums, and publishes the official Moai extension', async () => {
  const packageJson = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  const moaiPackage = JSON.parse(await readFile(new URL('packages/moai/package.json', root), 'utf8'))
  const manifest = JSON.parse(await readFile(new URL('packages/moai/extension.json', root), 'utf8'))
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const archive = `${manifest.id}-${manifest.version}.saycode-extension`

  assert.match(packageJson.scripts['package:moai'], /moai.*pack/)
  assert.equal(moaiPackage.version, manifest.version)
  assert.equal(manifest.apiVersion, 3)
  assert.match(workflow, /npm run package:moai/)
  // Plain substring checks: the archive name comes from the manifest, so no regular expression is built from it.
  assert.ok(workflow.includes(`packages/moai/${archive}.sha256`))
  assert.ok(workflow.includes(`packages/moai/${archive}`))
})


test('every checksummed release package publishes the archive its manifest version produces', async () => {
  const workflow = await readFile(new URL('.github/workflows/release.yml', root), 'utf8')
  const dirs = [...workflow.matchAll(/working-directory: (\S+)\n\s+run: sha256sum/g)].map((match) => match[1])
  assert.ok(dirs.length >= 10)
  for (const dir of dirs) {
    const manifest = JSON.parse(await readFile(new URL(`${dir}/extension.json`, root), 'utf8'))
    const archive = `${manifest.id}-${manifest.version}.saycode-extension`
    // A version bump without the matching workflow edit makes `gh release create` fail on a missing file.
    assert.ok(workflow.includes(`sha256sum *.saycode-extension > ${archive}.sha256`), `${dir} checksum names ${archive}`)
    assert.ok(workflow.includes(`${dir}/${archive}\n`), `${dir} publishes ${archive}`)
    assert.ok(workflow.includes(`${dir}/${archive}.sha256\n`), `${dir} publishes ${archive}.sha256`)
  }
})
