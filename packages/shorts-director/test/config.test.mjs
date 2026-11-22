import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { loadConfig, loadEnv, loadTts } from '../lib/config.mjs'

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

test('the repository root .env is read under the work folder .env and over the PC-level config', () => withDirs(async ({ home, project, userEnv }) => {
  const work = join(project, 'shorts', 'demo')
  await mkdir(work, { recursive: true })
  await writeFile(join(project, '.git'), 'gitdir: /elsewhere/.git/worktrees/demo\n')
  await writeFile(userEnv, 'LTX_URL=http://pc:8010\nQWEN_TTS_URL=http://pc:8765\n')
  await writeFile(join(project, '.env'), 'LTX_URL=http://repo:8010\nQWEN_TTS_URL=http://repo:8765\nQWEN_TTS_TOKEN=repo-token\n')
  await writeFile(join(work, '.env'), 'LTX_URL=http://work:8010\n')
  assert.deepEqual(await loadEnv(work, { home }), { LTX_URL: 'http://work:8010', QWEN_TTS_URL: 'http://repo:8765', QWEN_TTS_TOKEN: 'repo-token' })
  assert.deepEqual(await loadTts(work, { home }), { url: 'http://repo:8765', token: 'repo-token' })
}))

test('a .env above the work folder is not read when no repository root encloses it', () => withDirs(async ({ home, project }) => {
  const work = join(project, 'shorts', 'demo')
  await mkdir(work, { recursive: true })
  await writeFile(join(project, '.env'), 'LTX_URL=http://stray:8010\n')
  assert.deepEqual(await loadEnv(work, { home }), {})
}))

test('the token file is the last fallback for the TTS token',() => withDirs(async ({ home, project }) => {
  await writeFile(join(home, '.config', 'shorts-director', 'tts-token'), 'file-token\n')
  assert.equal((await loadEnv(project, { home })).QWEN_TTS_TOKEN, 'file-token')
}))

test('init --ltx-url --tts-url saves the server addresses once per PC, keeps what is there and never writes a token', () => withDirs(async ({ home, project, userEnv }) => {
  const env = { ...process.env, HOME: home }
  await exec(process.execPath, [cli, 'init', '--offline', '--ltx-url', 'http://172.0.0.1:8010', '--tts-url', 'http://172.0.0.1:8765'], { cwd: project, env })
  const saved = await readFile(userEnv, 'utf8')
  assert.match(saved, /^LTX_URL=http:\/\/172\.0\.0\.1:8010$/m)
  assert.match(saved, /^QWEN_TTS_URL=http:\/\/172\.0\.0\.1:8765$/m)
  assert.doesNotMatch(saved, /TOKEN=\S/)
  assert.equal((await stat(userEnv)).mode & 0o777, 0o600)

  await writeFile(userEnv, 'LTX_URL=http://mine:8010\n')
  const { stdout } = await exec(process.execPath, [cli, 'init', '--offline', '--ltx-url', 'http://other:8010', '--tts-url', 'http://other:8765'], { cwd: project, env })
  assert.equal(await readFile(userEnv, 'utf8'), 'LTX_URL=http://mine:8010\nQWEN_TTS_URL=http://other:8765\n', 'only the missing key is added')
  assert.match(stdout, /QWEN_TTS_URL/)
}))

test('the PC token is never sent to a voice server address that a project .env changed', () => withDirs(async ({ home, project, userEnv }) => {
  await writeFile(userEnv, 'QWEN_TTS_URL=http://pc:8765\n')
  await writeFile(join(home, '.config', 'shorts-director', 'tts-token'), 'pc-token\n')
  assert.deepEqual(await loadTts(project, { home }), { url: 'http://pc:8765', token: 'pc-token' })
  await writeFile(join(project, '.env'), 'QWEN_TTS_URL=http://elsewhere:8765\n')
  await assert.rejects(loadTts(project, { home }), /프로젝트 \.env/)
  await writeFile(join(project, '.env'), 'QWEN_TTS_URL=http://elsewhere:8765\nQWEN_TTS_TOKEN=project-token\n')
  assert.deepEqual(await loadTts(project, { home }), { url: 'http://elsewhere:8765', token: 'project-token' })
}))

test('the PC token is never sent to a voice server address that the repository root .env changed', () => withDirs(async ({ home, project, userEnv }) => {
  const work = join(project, 'shorts', 'demo')
  await mkdir(work, { recursive: true })
  await mkdir(join(project, '.git'))
  await writeFile(userEnv, 'QWEN_TTS_URL=http://pc:8765\n')
  await writeFile(join(home, '.config', 'shorts-director', 'tts-token'), 'pc-token\n')
  await writeFile(join(project, '.env'), 'QWEN_TTS_URL=http://elsewhere:8765\n')
  await assert.rejects(loadTts(work, { home }), /프로젝트 \.env/)
}))

test('the final frame rate follows the generated video, so no frame is shown twice', () => withDirs(async ({ project }) => {
  assert.equal((await loadConfig(project)).fps, 24)
  await mkdir(join(project, 'config'), { recursive: true })
  await writeFile(join(project, 'config', 'settings.json'), JSON.stringify({ video: { fps: 30 } }))
  assert.equal((await loadConfig(project)).fps, 30)
}))
