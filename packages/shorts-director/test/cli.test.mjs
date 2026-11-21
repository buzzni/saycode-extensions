import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = new URL('../bin/shorts-director.mjs', import.meta.url).pathname
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

async function inProject(run) {
  const root = await mkdtemp(join(tmpdir(), 'sd-cli-'))
  try {
    await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('--version prints the package version', async () => {
  const { stdout } = await exec(process.execPath, [cli, '--version'])
  assert.equal(stdout.trim(), pkg.version)
})

test('usage names the shorts-director command', async () => {
  const { stdout } = await exec(process.execPath, [cli])
  assert.match(stdout, /^usage: shorts-director </)
})

test('init prepares any project folder once: ignore rules and an env example, never overwriting', () => inProject(async (root) => {
  await writeFile(join(root, '.gitignore'), 'node_modules/\n.env\n')
  const first = await exec(process.execPath, [cli, 'init'], { cwd: root })
  assert.match(first.stdout, /\.env\.example/)
  const ignore = await readFile(join(root, '.gitignore'), 'utf8')
  assert.ok(ignore.startsWith('node_modules/\n.env\n'), 'existing rules are kept')
  for (const entry of ['knowledge/', 'takes/', 'audio/', 'out/', 'jobs/', '.work/', 'stills/']) assert.ok(ignore.split('\n').includes(entry), entry)
  assert.equal(ignore.split('\n').filter((line) => line === '.env').length, 1, 'no duplicate lines')
  const example = await readFile(join(root, '.env.example'), 'utf8')
  assert.match(example, /^LTX_URL=/m)
  assert.match(example, /^QWEN_TTS_URL=/m)
  assert.match(example, /^# QWEN_TTS_TOKEN=/m)

  await writeFile(join(root, '.env.example'), 'mine\n')
  await exec(process.execPath, [cli, 'init'], { cwd: root })
  assert.equal(await readFile(join(root, '.env.example'), 'utf8'), 'mine\n')
  assert.equal(await readFile(join(root, '.gitignore'), 'utf8'), ignore)
}))

test('import-knowledge requires the source repository path', async () => {
  await assert.rejects(exec(process.execPath, [cli, 'import-knowledge']), (error) => {
    assert.match(error.stderr, /--from/)
    return true
  })
})
