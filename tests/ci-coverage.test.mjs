import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

test('every test file runs in CI', async () => {
  // ci.yml names test files one by one rather than globbing, so a new file is silently never run on pull
  // requests — it would first execute on a release tag. This has already happened twice.
  const [workflow, entries] = await Promise.all([
    readFile(join(root, '.github/workflows/ci.yml'), 'utf8'),
    readdir(join(root, 'tests')),
  ])

  const testFiles = entries.filter((entry) => entry.endsWith('.test.mjs')).sort()
  assert.ok(testFiles.length > 0, 'expected to find test files')

  const missing = testFiles.filter((file) => !workflow.includes(`tests/${file}`))
  assert.deepEqual(missing, [], 'add these to .github/workflows/ci.yml so pull requests run them')
})
