import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { loadEnv } from '../lib/config.mjs'

const exec = promisify(execFile)
const cli = new URL('../bin/shorts-director.mjs', import.meta.url).pathname
const KEYS = ['LTX_URL', 'QWEN_TTS_URL', 'QWEN_TTS_TOKEN']

async function withDirs(run) {
  const base = await mkdtemp(join(tmpdir(), 'sd-config-'))
  const home = join(base, 'home')
  const project = join(base, 'project')
  await mkdir(join(home, '.config', 'shorts-director'), { recursive: true })
  await mkdir(project, { recursive: true })
  const saved = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]))
  for (const key of KEYS) delete process.env[key]
  try {
    await run({ home, project, userEnv: join(home, '.config', 'shorts-director', '.env') })
  } finally {
    for (const [key, value] of Object.entries(saved)) if (value !== undefined) process.env[key] = value
    await rm(base, { recursive: true, force: true })
  }
}

test('the PC-level config is read when the project has no .env', () => withDirs(async ({ home, project, userEnv }) => {
  await writeFile(userEnv, 'LTX_URL=http://pc:8010\nQWEN_TTS_URL=http://pc:8765\nQWEN_TTS_TOKEN=pc-token\n')
  assert.deepEqual(await loadEnv(project, { home }), { LTX_URL: 'http://pc:8010', QWEN_TTS_URL: 'http://pc:8765', QWEN_TTS_TOKEN: 'pc-token' })
}))

test('a project .env overrides the PC-level config key by key, and the shell overrides both', () => withDirs(async ({ home, project, userEnv }) => {
  await writeFile(userEnv, 'LTX_URL=http://pc:8010\nQWEN_TTS_URL=http://pc:8765\n')
  await writeFile(join(project, '.env'), 'LTX_URL=http://project:8010\n')
  process.env.QWEN_TTS_URL = 'http://shell:8765'
  const env = await loadEnv(project, { home })
  assert.equal(env.LTX_URL, 'http://project:8010')
  assert.equal(env.QWEN_TTS_URL, 'http://shell:8765')
}))

test('the token file is the last fallback for the TTS token', () => withDirs(async ({ home, project }) => {
  await writeFile(join(home, '.config', 'shorts-director', 'tts-token'), 'file-token\n')
  assert.equal((await loadEnv(project, { home })).QWEN_TTS_TOKEN, 'file-token')
}))

test('init --ltx-url --tts-url saves the server addresses once per PC, keeps what is there and never writes a token', () => withDirs(async ({ home, project, userEnv }) => {
  const env = { ...process.env, HOME: home }
  await exec(process.execPath, [cli, 'init', '--ltx-url', 'http://172.0.0.1:8010', '--tts-url', 'http://172.0.0.1:8765'], { cwd: project, env })
  const saved = await readFile(userEnv, 'utf8')
  assert.match(saved, /^LTX_URL=http:\/\/172\.0\.0\.1:8010$/m)
  assert.match(saved, /^QWEN_TTS_URL=http:\/\/172\.0\.0\.1:8765$/m)
  assert.doesNotMatch(saved, /TOKEN=\S/)
  assert.equal((await stat(userEnv)).mode & 0o777, 0o600)

  await writeFile(userEnv, 'LTX_URL=http://mine:8010\n')
  const { stdout } = await exec(process.execPath, [cli, 'init', '--ltx-url', 'http://other:8010', '--tts-url', 'http://other:8765'], { cwd: project, env })
  assert.equal(await readFile(userEnv, 'utf8'), 'LTX_URL=http://mine:8010\nQWEN_TTS_URL=http://other:8765\n', 'only the missing key is added')
  assert.match(stdout, /QWEN_TTS_URL/)
}))
