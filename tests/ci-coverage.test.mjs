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

test('workflows pin every external action to an immutable commit', async () => {
  const workflowDirectory = join(root, '.github/workflows')
  const workflows = (await readdir(workflowDirectory)).filter((entry) => entry.endsWith('.yml'))

  for (const workflow of workflows) {
    const source = await readFile(join(workflowDirectory, workflow), 'utf8')
    const actions = [...source.matchAll(/^\s*- uses:\s*([^\s#]+)/gm)].map((match) => match[1])
    const mutable = actions.filter((action) => !action.startsWith('./') && !/@[0-9a-f]{40}$/.test(action))
    assert.deepEqual(mutable, [], `${workflow} must pin external actions to full commit SHAs`)
  }
})

test('dependabot monitors both npm and GitHub Actions dependencies', async () => {
  const source = await readFile(join(root, '.github/dependabot.yml'), 'utf8')

  assert.match(source, /package-ecosystem:\s*npm/)
  assert.match(source, /package-ecosystem:\s*github-actions/)
})
