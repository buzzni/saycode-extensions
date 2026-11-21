#!/usr/bin/env node
// 숏폼 총감독 도구(npx @buzzni/shorts-director). 현재 작업 폴더(프로젝트 루트)를 상태 저장소로 쓴다.
// 영상은 LTX 로컬 서버, 음성은 Qwen3-TTS 서버(주소·토큰은 .env). config/settings.json 의 fake: true 면 서버 없이 리허설한다.
import { spawnSync } from 'node:child_process'
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { fakeSpeech, fakeVideoBackend } from '../lib/backends/fake.mjs'
import { LTX_TAKE_SECONDS, ltxVideoBackend } from '../lib/backends/ltx.mjs'
import { qwenSpeech } from '../lib/backends/qwen-tts.mjs'
import { layoutNarration } from '../lib/captions.mjs'
import { loadConfig, loadEnv, loadTts, saveUserEnv, userConfigDir } from '../lib/config.mjs'
import { JobStore } from '../lib/jobs.mjs'
import { detectCuts, extractFrame, probe, run, tightenSpeech } from '../lib/media.mjs'
import { countTakes, planSeconds, validatePlan } from '../lib/plan.mjs'
import { contactSheet, renderVideo } from '../lib/render.mjs'
import { ACTIVE_STATES, materialPath, resolveTakes, sha256 } from '../lib/takeState.mjs'

const USAGE = 'usage: shorts-director <init [--ltx-url URL --tts-url URL]|doctor|check|voice|animatic|takes submit|takes poll|takes wait [--minutes N]|takes forget <id>|takes status|render|sheet [--draft]|cuts <file>|status|import-knowledge --from <shorts_maker>|--version>'
const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const IGNORED = ['.env', 'knowledge/', '.work/', 'stills/', 'takes/', 'audio/', 'out/', 'jobs/']
const ENV_EXAMPLE = `# 이 프로젝트에서만 다른 서버를 쓸 때만 .env 로 복사해 채운다(.env 는 커밋하지 않는다).
# 보통은 shorts-director init --ltx-url <주소> --tts-url <주소> 로 이 PC 에 한 번 저장하면 된다
# (~/.config/shorts-director/.env). 토큰은 ~/.config/shorts-director/tts-token 에 한 줄로 둔다.
LTX_URL=http://<영상 서버>:8010
QWEN_TTS_URL=http://<음성 서버>:8765
# QWEN_TTS_TOKEN=
`
const root = process.cwd()
const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const args = rest.filter((arg) => !arg.startsWith('--'))

const commands = { init, doctor, check, voice, animatic, takes, render, sheet, cuts, status, 'import-knowledge': importKnowledge }

try {
  if (command === '--version' || command === '-v') {
    console.log(PACKAGE.version)
    process.exit(0)
  }
  if (!commands[command]) {
    console.log(USAGE)
    process.exit(command ? 1 : 0)
  }
  await commands[command]()
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(error.exitCode ?? 1)
}

// 아무 프로젝트 폴더나 쓸 수 있게 한 번 준비한다. 기존 파일은 덮어쓰지 않고, 무시 규칙은 빠진 줄만 더한다.
async function init() {
  let ignore = ''
  try {
    ignore = await readFile(join(root, '.gitignore'), 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const present = new Set(ignore.split('\n').map((line) => line.trim()))
  const missing = IGNORED.filter((entry) => !present.has(entry))
  if (missing.length) {
    const prefix = ignore && !ignore.endsWith('\n') ? '\n' : ''
    await writeFile(join(root, '.gitignore'), `${ignore}${prefix}${ignore ? '\n' : ''}# shorts-director\n${missing.join('\n')}\n`)
    console.log(`✓ .gitignore 에 ${missing.length}줄 추가`)
  }
  if (!await exists(join(root, '.env.example'))) {
    await writeFile(join(root, '.env.example'), ENV_EXAMPLE)
    console.log('✓ .env.example — 이 프로젝트만 다른 서버를 쓸 때 .env 로 복사한다')
  }
  await mkdir(join(root, 'materials'), { recursive: true })
  const ltx = optionValue('--ltx-url')
  const tts = optionValue('--tts-url')
  if (ltx || tts) {
    const added = await saveUserEnv({ LTX_URL: ltx, QWEN_TTS_URL: tts })
    const file = join(userConfigDir(), '.env')
    console.log(added.length ? `✓ 이 PC 설정(${file})에 ${added.join(', ')} 저장 — 모든 프로젝트에서 쓴다` : `이 PC 설정(${file})에 서버 주소가 이미 있다 — 그대로 둔다`)
  }
  console.log('다음: shorts-director doctor')
}

function optionValue(name) {
  const index = rest.indexOf(name)
  return index >= 0 ? rest[index + 1] : undefined
}

async function importKnowledge() {
  const from = rest[rest.indexOf('--from') + 1]
  if (!rest.includes('--from') || !from) throw new Error('usage: shorts-director import-knowledge --from <shorts_maker 경로>')
  const script = fileURLToPath(new URL('../lib/import-viskit-knowledge.py', import.meta.url))
  const result = spawnSync('python3', ['-I', script, '--from', from, '--out', join(root, 'knowledge')], { stdio: 'inherit' })
  if (result.error) throw new Error(`python3 를 실행하지 못했다: ${result.error.message}`)
  if (result.status !== 0) process.exit(result.status ?? 1)
}

async function doctor() {
  const config = await loadConfig(root)
  const env = await loadEnv(root)
  const results = []
  const probeTool = async (name, command, commandArgs) => {
    try {
      await run(command, commandArgs)
      results.push([true, name])
    } catch (error) {
      results.push([false, `${name}: ${error.message.split('\n')[0]}`])
    }
  }
  await probeTool('ffmpeg', 'ffmpeg', ['-version'])
  await probeTool('macOS 글자 렌더러(osascript)', 'osascript', ['-e', '1'])
  if (config.fake) {
    results.push([true, '가짜 백엔드 모드(fake: true) — 서버는 확인하지 않는다'])
  } else {
    results.push(await checkServer('LTX 영상 서버', env.LTX_URL, '/readyz', {}, (json) => json.ready ? `준비됨, 대기 ${json.queued}건` : `준비 안 됨: ${json.error}`))
    const tts = await loadTts(root).catch((error) => ({ error }))
    if (tts.error) results.push([false, `Qwen TTS 서버: ${tts.error.message}`])
    else results.push(await checkServer('Qwen TTS 서버', tts.url, '/v1/voices',
      tts.token ? { Authorization: `Bearer ${tts.token}` } : {},
      (json) => `목소리 ${json.speakers?.length ?? 0}개(기본 ${json.default_speaker}), 언어에 ${config.voice.language} ${json.languages?.includes(config.voice.language) ? '있음' : '없음'}`))
  }
  for (const [ok, message] of results) console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (results.some(([ok]) => !ok)) process.exit(1)
}

async function checkServer(name, url, path, headers, describe) {
  if (!url) return [false, `${name}: 주소가 없다 — shorts-director init --ltx-url <주소> --tts-url <주소> 로 이 PC 에 한 번 저장하거나 프로젝트 .env 에 ${name.startsWith('LTX') ? 'LTX_URL' : 'QWEN_TTS_URL'} 를 넣는다`]
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, { headers, signal: AbortSignal.timeout(10_000) })
    const json = await response.json().catch(() => ({}))
    if (response.status === 401) return [false, `${name}: 토큰이 없거나 틀렸다 — ~/.config/shorts-director/tts-token 에 한 줄로 넣는다`]
    if (!response.ok) return [false, `${name}: HTTP ${response.status}`]
    return [true, `${name}: ${describe(json)}`]
  } catch (error) {
    return [false, `${name}: 연결 실패 (${error.message})`]
  }
}

async function check() {
  const plan = await loadPlan()
  const result = validatePlan(plan, { take: LTX_TAKE_SECONDS })
  for (const issue of result.issues) console.log(`${issue.level === 'error' ? '✗' : '!'} ${issue.code}${issue.where ? ` (${issue.where})` : ''}: ${issue.message}`)
  const errors = result.issues.filter((issue) => issue.level === 'error').length
  const takeCount = countTakes(plan)
  console.log(`오류 ${errors} · 경고 ${result.issues.length - errors} · 길이 ${planSeconds(plan)}초 · 테이크 ${takeCount}개 (LTX 한 개 약 1분 30초, 순서대로 처리)`)
  if (errors) process.exit(1)
}

async function voice() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const tts = config.fake ? {} : await loadTts(root)
  const speak = config.fake ? fakeSpeech : qwenSpeech({ baseUrl: tts.url, token: tts.token })
  await mkdir(join(root, 'audio', 'narration'), { recursive: true })
  const measured = []
  for (const [index, line] of (plan.narration ?? []).entries()) {
    const name = String(index).padStart(2, '0')
    const raw = join(root, 'audio', 'narration', `${name}.raw.wav`)
    const file = join('audio', 'narration', `${name}.wav`)
    await speak(raw, { text: line.text, language: config.voice.language, speaker: line.speaker ?? config.voice.speaker })
    await tightenSpeech(raw, join(root, file))
    const minStart = line.moment ? momentStart(plan, line.moment) + config.voice.start : undefined
    measured.push({ text: line.text, file, seconds: Math.round((await probe(join(root, file))).duration * 1000) / 1000, ...(minStart === undefined ? {} : { minStart }) })
    console.log(`✓ ${name} ${measured.at(-1).seconds}초 — ${line.text}`)
  }
  const lines = layoutNarration(measured, { start: config.voice.start, gap: config.voice.gap })
  const total = planSeconds(plan)
  const end = lines.at(-1)?.end ?? 0
  await writeFile(join(root, 'audio', 'narration.json'), `${JSON.stringify({ lines, end, videoSeconds: total }, null, 2)}\n`)
  console.log(`✓ 내레이션 ${lines.length}줄 · 끝 ${end}초 / 영상 ${total}초`)
  if (end > total - 0.2) console.log(`! 내레이션이 영상보다 ${Math.round((end - total + 0.2) * 10) / 10}초 길다 — 문장을 줄이거나 장면을 늘린다.`)
}

async function animatic() {
  const out = join(root, 'out', 'draft.mp4')
  const result = await renderVideo({ root, plan: await loadPlan(), config: await loadConfig(root), mode: 'draft', narration: await loadNarration(), out })
  console.log(`✓ 애니매틱 ${result.seconds}초 → out/draft.mp4 (영상 생성 없음)`)
}

async function render() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const entries = await resolveTakes(root, plan, config, await new JobStore(root).list())
  const missing = [...entries.values()].filter((entry) => !entry.done).map((entry) => entry.moment.id)
  if (missing.length) throw Object.assign(new Error(`지금 기획에 맞는 테이크가 아직 없다: ${missing.join(', ')} — takes submit / takes wait 를 먼저 한다`), { exitCode: 2 })
  // takes/ 의 파일이 지금 기획의 결과가 아니면(다른 버전) 그 작업의 결과로 되돌린다.
  for (const entry of entries.values()) await placeTake(entry.moment.id, entry.done)
  const out = join(root, 'out', 'final.mp4')
  const result = await renderVideo({ root, plan, config, mode: 'final', narration: await loadNarration(), out })
  console.log(`✓ 완성본 ${result.seconds}초 → out/final.mp4 (검수 대기)`)
}

async function takes() {
  const sub = args[0] ?? 'status'
  const config = await loadConfig(root)
  const store = new JobStore(root)
  if (sub === 'status') return printJobs(await store.list())
  const unlock = await lockTakes()
  try {
    if (sub === 'submit') return await submitTakes(await loadPlan(), config, store)
    if (sub === 'poll') return void await pollTakes(config, store)
    if (sub === 'wait') return await waitTakes(await loadPlan(), config, store)
    if (sub === 'forget') return await forgetTakes(store, args[1])
    throw new Error(`unknown takes command: ${sub}`)
  } finally {
    await unlock()
  }
}

// 같은 프로젝트에서 takes 명령이 동시에 돌면 같은 작업을 두 번 내거나 상태가 엇갈린다.
async function lockTakes() {
  await mkdir(join(root, 'jobs'), { recursive: true })
  const file = join(root, 'jobs', '.lock')
  try {
    await writeFile(file, String(process.pid), { flag: 'wx' })
  } catch (error) {
    if (error.code !== 'EEXIST') throw error
    const pid = Number(await readFile(file, 'utf8').catch(() => ''))
    if (pid && pid !== process.pid && isAlive(pid)) throw new Error(`다른 takes 명령이 실행 중이다(pid ${pid}) — 끝난 뒤 다시 한다`)
    await writeFile(file, String(process.pid))
  }
  return () => rm(file, { force: true })
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

// onlyNew: 기다리는 중의 자동 제출 — 실패로 끝난 테이크는 다시 내지 않는다(사용자·에이전트가 takes submit 으로 다시 낸다).
async function submitTakes(plan, config, store, { onlyNew = false } = {}) {
  const backend = await videoBackend(config)
  const entries = await resolveTakes(root, plan, config, await store.list())
  for (const entry of entries.values()) {
    const id = entry.moment.id
    if (entry.done) {
      await placeTake(id, entry.done)
      if (!onlyNew) console.log(`↺ ${id} 재사용 (${entry.done.id})`)
      continue
    }
    if (entry.active) {
      if (!onlyNew) console.log(`… ${id} 진행 중 (${entry.active.state}) — takes wait 로 기다린다`)
      continue
    }
    if (entry.blockedBy) {
      if (!onlyNew) console.log(`… ${id} 대기 — ${entry.blockedBy} 가 끝나면 그 마지막 프레임에서 시작한다`)
      continue
    }
    if (onlyNew && entry.failed) continue
    let job
    try {
      job = await store.create(entry.take, backend.name)
      await store.transition(job.id, 'submitting')
      const submitted = await backend.submit(entry.take, { firstFrame: await firstFrameData(id, entry.take.firstFrame, entries) })
      await store.transition(job.id, 'submitted', { remoteId: submitted.remoteId })
      console.log(`→ ${id} 제출 (${backend.name}, ${submitted.remoteId})`)
    } catch (error) {
      // 로컬 서버라 제출 실패에 비용이 없다. 실패로 닫고 다음 takes submit 에서 새로 낸다.
      if (job) await store.transition(job.id, 'failed', { reason: error.message }).catch(() => {})
      console.log(`✗ ${id} 제출 실패: ${error.message}`)
      if (error.status === 429) {
        console.log('! 서버 대기열이 찼다 — takes wait 뒤에 다시 submit 한다')
        break
      }
    }
  }
}

async function firstFrameData(momentId, firstFrame, entries) {
  if (!firstFrame) return undefined
  if (firstFrame.file) return (await readFile(materialPath(root, firstFrame.file))).toString('base64')
  await mkdir(join(root, 'stills'), { recursive: true })
  const still = join(root, 'stills', `${momentId}-first.png`)
  // takes/ 가 아니라 해시로 고른 그 작업의 결과에서 뽑는다 — takes/ 에는 다른 버전이 있을 수 있다.
  await extractFrame(join(root, entries.get(firstFrame.take).done.file), still, firstFrame.at)
  return (await readFile(still)).toString('base64')
}

// 작업마다 자기 파일(jobs/<작업>.mp4)에 받고, 지금 기획에 맞는 것만 takes/<장면>.mp4 로 둔다.
async function placeTake(momentId, job) {
  const target = join(root, 'takes', `${momentId}.mp4`)
  if (await exists(target) && sha256(await readFile(target)) === job.sha256) return false
  await mkdir(join(root, 'takes'), { recursive: true })
  await copyFile(join(root, job.file), target)
  return true
}

async function pollTakes(config, store) {
  const active = (await store.list()).filter((job) => ['submitted', 'generating', 'unknown', 'ready'].includes(job.state) && job.remoteId)
  const backend = active.length ? await videoBackend(config) : undefined
  for (const job of active) {
    const file = join('jobs', `${job.id}.mp4`)
    try {
      const result = await backend.poll(job, { saveTo: join(root, file) })
      if (result.status === 'generating') {
        if (job.state !== 'generating') await store.transition(job.id, 'generating')
        console.log(`… ${job.momentId} 생성 중`)
      } else if (result.status === 'completed') {
        if (job.state !== 'ready') await store.transition(job.id, 'ready')
        const done = await store.transition(job.id, 'downloaded', { file, sha256: sha256(await readFile(join(root, file))) })
        await placeTake(job.momentId, done)
        console.log(`✓ ${job.momentId} → takes/${job.momentId}.mp4`)
      } else {
        await store.transition(job.id, result.status, { reason: result.reason })
        console.log(`✗ ${job.momentId} ${result.status}: ${result.reason}`)
      }
    } catch (error) {
      if (job.state !== 'unknown') await store.transition(job.id, 'unknown', { reason: error.message })
      console.log(`? ${job.momentId} 확인 실패(다시 확인한다, 다시 제출하지 않는다): ${error.message}`)
    }
  }
  return active.length
}

async function waitTakes(plan, config, store) {
  const minutes = Number(optionValue('--minutes')) || 30
  const deadline = Date.now() + minutes * 60_000
  const interval = config.fake ? 100 : 10_000
  while (Date.now() < deadline) {
    await pollTakes(config, store)
    let entries = await resolveTakes(root, plan, config, await store.list())
    // 앞 테이크가 끝나 이제 낼 수 있게 된 이어 찍기 테이크를 낸다.
    if ([...entries.values()].some((entry) => submittable(entry))) {
      await submitTakes(plan, config, store, { onlyNew: true })
      entries = await resolveTakes(root, plan, config, await store.list())
    }
    const moving = [...entries.values()].some((entry) => entry.active || submittable(entry))
    if (!moving) return reportTakes(entries)
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw Object.assign(new Error(`${minutes}분 안에 끝나지 않았다 — 생성은 서버에서 계속된다. takes wait 를 다시 한다`), { exitCode: 2 })
}

function submittable(entry) {
  return !entry.done && !entry.active && !entry.blockedBy && !entry.failed
}

function reportTakes(entries) {
  const broken = [...entries.values()].filter((entry) => !entry.done)
  if (broken.length === 0) {
    console.log('✓ 기다릴 테이크가 없다 — 모두 받았다')
    return
  }
  for (const entry of broken) {
    const reason = entry.failed
      ? `${entry.failed.state}: ${entry.failed.history.at(-1)?.reason ?? ''}`
      : `앞 테이크 ${entry.blockedBy} 가 없어 시작하지 못함`
    console.log(`✗ ${entry.moment.id} — ${reason}`)
  }
  console.log('실패한 테이크는 원인을 고친 뒤 takes submit 으로 다시 낸다(이어 찍는 뒤 테이크는 자동으로 따라간다).')
  process.exit(2)
}

async function forgetTakes(store, momentId) {
  if (!momentId) throw new Error('usage: shorts-director takes forget <장면 id>')
  const open = (await store.list()).filter((job) => job.momentId === momentId && ACTIVE_STATES.includes(job.state))
  for (const job of open) await store.transition(job.id, 'failed', { reason: '사용자가 정리함(takes forget)' })
  console.log(open.length ? `✓ ${momentId} 의 진행 중 작업 ${open.length}개를 닫았다 — takes submit 으로 다시 낸다` : `${momentId} 에 진행 중인 작업이 없다`)
}

async function sheet() {
  const input = join(root, 'out', flags.has('--draft') ? 'draft.mp4' : 'final.mp4')
  await contactSheet(input, join(root, 'out', 'contact.png'))
  console.log('✓ out/contact.png — 글자 겹침·안전 영역·가짜 글자·인물 일관성을 본다')
}

async function cuts() {
  if (!args[0]) throw new Error('usage: shorts-director cuts <video file>')
  console.log(JSON.stringify({ file: args[0], cuts: await detectCuts(join(root, args[0])) }))
}

// 진행판을 다시 만든다. "## 메모" 아래는 사람·에이전트가 쓰는 칸이라 그대로 둔다.
async function status() {
  const file = join(root, 'status.md')
  const previous = await readFile(file, 'utf8').catch(() => '')
  const notesAt = previous.indexOf('\n## 메모')
  const notes = notesAt >= 0 ? previous.slice(notesAt + 1) : ''
  const plan = await readFile(join(root, 'plan.json'), 'utf8').then(JSON.parse, () => undefined)
  const has = async (path) => (await exists(join(root, path))) ? '✓' : '·'
  let lines
  if (!plan) {
    lines = ['# 숏폼 — 진행판', '', '- · 기획 (plan.json 없음 — ①~③ 진행 중)', '']
  } else {
    const entries = await resolveTakes(root, plan, await loadConfig(root), await new JobStore(root).list())
    const all = [...entries.values()]
    const done = all.filter((entry) => entry.done).length
    const validation = validatePlan(plan, { take: LTX_TAKE_SECONDS })
    const stateOf = (entry) => entry.done ? '받음' : entry.active ? entry.active.state : entry.failed ? `${entry.failed.state}: ${entry.failed.history.at(-1)?.reason ?? ''}` : entry.blockedBy ? `${entry.blockedBy} 대기` : '아직'
    lines = [
      `# ${plan.title ?? '숏폼'} — 진행판`,
      '',
      `- ${validation.ok ? '✓' : '✗'} 기획 검증 (plan.json)`,
      `- ${await has('audio/narration.json')} 내레이션 (audio/narration.json)`,
      `- ${await has('out/draft.mp4')} 애니매틱 (out/draft.mp4)`,
      `- ${done === all.length && all.length ? '✓' : '·'} 테이크 ${done}/${all.length}`,
      `- ${await has('out/final.mp4')} 완성본 (out/final.mp4, 검수 대기)`,
      '',
      '| 테이크 | 상태 |',
      '|---|---|',
      ...all.map((entry) => `| ${entry.moment.id} | ${stateOf(entry)} |`),
      '',
    ]
  }
  const text = `${lines.join('\n')}${notes ? `\n${notes}` : ''}`
  await writeFile(file, text)
  console.log(text)
}

async function videoBackend(config) {
  if (config.fake) return fakeVideoBackend({ video: config.video, fail: config.fake.fail ?? [] })
  return ltxVideoBackend({ baseUrl: (await loadEnv(root)).LTX_URL, video: config.video })
}

function momentStart(plan, id) {
  let cursor = 0
  for (const moment of plan.moments) {
    if (moment.id === id) return cursor
    cursor += Number(moment.seconds)
  }
  throw new Error(`narration 이 없는 장면 ${id} 를 가리킨다`)
}

async function loadPlan() {
  try {
    return JSON.parse(await readFile(join(root, 'plan.json'), 'utf8'))
  } catch (error) {
    throw new Error(`plan.json 을 읽지 못했다: ${error.message}`)
  }
}

async function loadNarration() {
  try {
    return JSON.parse(await readFile(join(root, 'audio', 'narration.json'), 'utf8')).lines
  } catch {
    return []
  }
}

function printJobs(jobs) {
  if (jobs.length === 0) return console.log('테이크 작업이 없다')
  for (const job of jobs) console.log(`${job.momentId}\t${job.state}\t${job.backend}\t${job.remoteId ?? ''}`)
}

async function exists(path) {
  return access(path).then(() => true, () => false)
}
