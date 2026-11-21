import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = new URL('../packages/shorts-director', import.meta.url).pathname
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('shorts-director is a public npm CLI package with an explicit file whitelist', async () => {
  assert.equal(manifest.name, '@buzzni/shorts-director')
  assert.notEqual(manifest.private, true)
  assert.equal(manifest.license, 'MIT')
  assert.deepEqual(manifest.publishConfig, { access: 'public' })
  assert.deepEqual(manifest.bin, { 'shorts-director': 'bin/shorts-director.mjs' })
  assert.deepEqual(manifest.files, ['bin', 'lib', 'README.md', 'LICENSE'])
  const entry = await readFile(join(root, manifest.bin['shorts-director']), 'utf8')
  assert.ok(entry.startsWith('#!/usr/bin/env node\n'), 'the bin runs through npx')
  for (const file of manifest.files) await access(join(root, file))
})

test('the published tarball carries only the runtime: no tests, no private knowledge, no secrets', async () => {
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root })
  const [packed] = JSON.parse(stdout)
  const files = packed.files.map((file) => file.path).sort()
  assert.ok(files.includes('bin/shorts-director.mjs'))
  assert.ok(files.includes('lib/caption.jxa.js'), 'the caption renderer ships next to the code that loads it')
  assert.ok(files.includes('lib/import-viskit-knowledge.py'))
  const leaked = files.filter((file) => /^(test|knowledge)\//.test(file) || /(^|\/)\.env/.test(file) || /\.(mp4|wav|png)$/.test(file))
  assert.deepEqual(leaked, [])
})
