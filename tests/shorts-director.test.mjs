import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const root = new URL('../packages/shorts-director', import.meta.url).pathname
const template = join(root, 'templates/shorts-director')

async function filesBelow(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  }
  return files.sort()
}

test('shorts-director declares one namespaced project template that ships the skill and tools', async () => {
  const manifest = parseExtensionManifest(JSON.parse(await readFile(join(root, 'extension.json'), 'utf8')), { supportedApiVersion: 2 })
  assert.equal(manifest.id, 'buzzni.shorts-director')
  assert.deepEqual(manifest.permissions, [])
  const [studio] = manifest.contributes.projectTemplates
  assert.equal(studio.id, 'buzzni.shorts-director.studio')
  assert.equal(studio.assetsRoot, 'templates/shorts-director')
  assert.match(studio.localizations.ko.firstPrompt, /SKILL\.md/)

  const files = await filesBelow(template)
  for (const required of ['.claude/skills/shorts-director/SKILL.md', '.gitignore', 'AGENTS.md', 'CLAUDE.md', 'README.md', 'config/settings.json', 'tools/sd.mjs', 'tools/import-viskit-knowledge.py']) {
    assert.ok(files.includes(required), `${required} is shipped`)
  }
})

test('the public template never carries private knowledge, secrets or generated media', async () => {
  const files = await filesBelow(template)
  const leaked = files.filter((file) => /^(knowledge|takes|stills|audio|out|jobs|\.work)\//.test(file) || file === '.env' || /\.(mp4|wav|png)$/.test(file))
  assert.deepEqual(leaked, [])
  const ignore = (await readFile(join(template, '.gitignore'), 'utf8')).split('\n')
  for (const entry of ['.env', 'knowledge/', 'takes/', 'out/']) assert.ok(ignore.includes(entry), `${entry} is git-ignored in created projects`)
})

test('the template stays inside project-template asset limits', async () => {
  const files = await filesBelow(template)
  assert.ok(files.length < 500)
  let total = 0
  for (const file of files) {
    const size = (await readFile(join(template, file))).length
    assert.ok(size < 1024 * 1024, `${file} is under 1 MiB`)
    total += size
  }
  assert.ok(total < 10 * 1024 * 1024)
})
