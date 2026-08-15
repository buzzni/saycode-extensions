import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { test } from 'node:test'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const root = new URL('../packages/project-templates', import.meta.url).pathname

async function filesBelow(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) files.push(relative(directory, join(entry.parentPath, entry.name)).replaceAll('\\', '/'))
  }
  return files.sort()
}

test('official project-templates package declares three namespaced asset trees without Desktop imports', async () => {
  const manifest = parseExtensionManifest(
    JSON.parse(await readFile(join(root, 'extension.json'), 'utf8')),
    { supportedApiVersion: 1 },
  )

  assert.equal(manifest.id, 'buzzni.project-templates')
  assert.deepEqual(manifest.contributes.projectTemplates.map((template) => template.id), [
    'buzzni.project-templates.dashboard',
    'buzzni.project-templates.survey-form',
    'buzzni.project-templates.api-backoffice',
  ])
  assert.deepEqual(await filesBelow(join(root, 'templates')), [
    'api-backoffice/README.md',
    'api-backoffice/index.html',
    'api-backoffice/package.json',
    'api-backoffice/src/App.tsx',
    'api-backoffice/src/api.ts',
    'api-backoffice/src/main.tsx',
    'api-backoffice/src/styles.css',
    'api-backoffice/tsconfig.json',
    'api-backoffice/vite.config.ts',
    'dashboard/README.md',
    'dashboard/index.html',
    'dashboard/package.json',
    'dashboard/src/App.tsx',
    'dashboard/src/main.tsx',
    'dashboard/src/styles.css',
    'dashboard/tsconfig.json',
    'dashboard/vite.config.ts',
    'survey-form/README.md',
    'survey-form/index.html',
    'survey-form/package.json',
    'survey-form/src/App.tsx',
    'survey-form/src/main.tsx',
    'survey-form/src/styles.css',
    'survey-form/tsconfig.json',
    'survey-form/vite.config.ts',
  ])
  assert.doesNotMatch(await readFile(join(root, 'src/index.ts'), 'utf8'), /aplus-dev-studio|@\/|electron|@buzzni\/saycode-core/)
})
