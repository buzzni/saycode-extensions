#!/usr/bin/env node
// 숏폼 총감독 도구. 현재 작업 폴더(프로젝트 루트)를 상태 저장소로 쓴다.
// 영상은 LTX 로컬 서버, 음성은 Qwen3-TTS 서버(주소·토큰은 .env). config/settings.json 의 fake: true 면 서버 없이 리허설한다.
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { fakeSpeech, fakeVideoBackend } from './lib/backends/fake.mjs'
import { LTX_TAKE_SECONDS, ltxVideoBackend } from './lib/backends/ltx.mjs'
import { qwenSpeech } from './lib/backends/qwen-tts.mjs'
import { layoutNarration } from './lib/captions.mjs'
import { loadConfig, loadEnv } from './lib/config.mjs'
import { JobStore } from './lib/jobs.mjs'
import { detectCuts, extractFrame, probe, run, tightenSpeech } from './lib/media.mjs'
import { countTakes, planSeconds, validatePlan } from './lib/plan.mjs'
import { contactSheet, renderVideo } from './lib/render.mjs'
import { buildTake } from './lib/takes.mjs'

const USAGE = 'usage: node tools/sd.mjs <doctor|check|voice|animatic|takes submit|takes poll|takes wait [--minutes N]|takes status|render|sheet [--draft]|cuts <file>|status>'
const root = process.cwd()
const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const args = rest.filter((arg) => !arg.startsWith('--'))

const commands = { doctor, check, voice, animatic, takes, render, sheet, cuts, status }

try {
  if (!commands[command]) {
    console.log(USAGE)
    process.exit(command ? 1 : 0)
  }
  await commands[command]()
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(error.exitCode ?? 1)
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
    results.push(await checkServer('Qwen TTS 서버', env.QWEN_TTS_URL, '/v1/voices',
      env.QWEN_TTS_TOKEN ? { Authorization: `Bearer ${env.QWEN_TTS_TOKEN}` } : {},
      (json) => `목소리 ${json.speakers?.length ?? 0}개(기본 ${json.default_speaker}), 언어에 ${config.voice.language} ${json.languages?.includes(config.voice.language) ? '있음' : '없음'}`))
  }
  for (const [ok, message] of results) console.log(`${ok ? '✓' : '✗'} ${message}`)
  if (results.some(([ok]) => !ok)) process.exit(1)
}

async function checkServer(name, url, path, headers, describe) {
  if (!url) return [false, `${name}: 주소가 없다 — .env 에 ${name.startsWith('LTX') ? 'LTX_URL' : 'QWEN_TTS_URL'} 를 넣는다`]
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, { headers, signal: AbortSignal.timeout(10_000) })
    const json = await response.json().catch(() => ({}))
    if (response.status === 401) return [false, `${name}: 토큰이 없거나 틀렸다 — QWEN_TTS_TOKEN`]
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
  const env = config.fake ? {} : await loadEnv(root)
  const speak = config.fake ? fakeSpeech : qwenSpeech({ baseUrl: env.QWEN_TTS_URL, token: env.QWEN_TTS_TOKEN })
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
  const missing = []
  for (const moment of plan.moments.filter((item) => item.kind === 'take')) {
    if (!await exists(join(root, 'takes', `${moment.id}.mp4`))) missing.push(moment.id)
  }
  if (missing.length) throw Object.assign(new Error(`테이크가 아직 없다: ${missing.join(', ')} — takes submit / takes wait 를 먼저 한다`), { exitCode: 2 })
  const out = join(root, 'out', 'final.mp4')
  const result = await renderVideo({ root, plan, config: await loadConfig(root), mode: 'final', narration: await loadNarration(), out })
  console.log(`✓ 완성본 ${result.seconds}초 → out/final.mp4 (검수 대기)`)
}

async function takes() {
  const sub = args[0] ?? 'status'
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const store = new JobStore(root)
  if (sub === 'status') return printJobs(await store.list())
  if (sub === 'submit') return submitTakes(plan, config, store)
  if (sub === 'poll') return pollTakes(config, store)
  if (sub === 'wait') return waitTakes(config, store)
  throw new Error(`unknown takes command: ${sub}`)
}

async function submitTakes(plan, config, store, { onlyNew = false } = {}) {
  const backend = await videoBackend(config)
  await mkdir(join(root, 'takes'), { recursive: true })
  const jobs = await store.list()
  for (const moment of plan.moments.filter((item) => item.kind === 'take')) {
    // 기다리는 중의 자동 제출은 한 번도 내지 않은 테이크만 — 실패한 테이크를 계속 다시 내지 않는다.
    if (onlyNew && jobs.some((job) => job.momentId === moment.id)) continue
    const take = buildTake(moment, plan, config)
    const target = join(root, 'takes', `${moment.id}.mp4`)
    // 이어 찍는 테이크는 시작 테이크가 받아진 뒤에만 낸다. 시작 프레임이 바뀌면 다른 요청이 되도록 그 해시를 넣는다.
    if (take.firstFrame?.take) {
      const source = jobs.findLast((job) => job.momentId === take.firstFrame.take && job.state === 'downloaded')
      if (!source) {
        if (!onlyNew) console.log(`… ${moment.id} 대기 — ${take.firstFrame.take} 가 끝나면 그 마지막 프레임에서 시작한다`)
        continue
      }
      take.firstFrame.sourceSha256 = source.sha256
    }
    const reusable = await store.findReusable(take)
    if (reusable) {
      if (!await exists(target)) await copyFile(join(root, reusable.file), target)
      console.log(`↺ ${moment.id} 재사용 (${reusable.id})`)
      continue
    }
    const inFlight = (await store.list()).find((job) => job.momentId === moment.id && ['submitting', 'submitted', 'generating', 'ready', 'unknown'].includes(job.state))
    if (inFlight) {
      console.log(`… ${moment.id} 이미 제출됨 (${inFlight.state}) — takes wait 로 기다린다`)
      continue
    }
    const job = await store.create(take, backend.name)
    await store.transition(job.id, 'submitting')
    try {
      const submitted = await backend.submit(take, { firstFrame: await firstFrameData(moment.id, take.firstFrame) })
      await store.transition(job.id, 'submitted', { remoteId: submitted.remoteId })
      console.log(`→ ${moment.id} 제출 (${backend.name}, ${submitted.remoteId})`)
    } catch (error) {
      // 로컬 서버라 제출 실패에 비용이 없다. 실패로 닫고 다음 submit 에서 새로 낸다.
      await store.transition(job.id, 'failed', { reason: error.message })
      console.log(`✗ ${moment.id} 제출 실패: ${error.message}`)
      if (error.status === 429) {
        console.log('! 서버 대기열이 찼다 — takes wait 뒤에 다시 submit 한다')
        break
      }
    }
  }
}

async function firstFrameData(momentId, firstFrame) {
  if (!firstFrame) return undefined
  if (firstFrame.file) return (await readFile(join(root, firstFrame.file))).toString('base64')
  await mkdir(join(root, 'stills'), { recursive: true })
  const still = join(root, 'stills', `${momentId}-first.png`)
  await extractFrame(join(root, 'takes', `${firstFrame.take}.mp4`), still, firstFrame.at)
  return (await readFile(still)).toString('base64')
}

async function pollTakes(config, store) {
  const active = (await store.list()).filter((job) => ['submitted', 'generating', 'unknown'].includes(job.state) && job.remoteId)
  const backend = active.length ? await videoBackend(config) : undefined
  for (const job of active) {
    const file = join('takes', `${job.momentId}.mp4`)
    try {
      const result = await backend.poll(job, { saveTo: join(root, file) })
      if (result.status === 'generating') {
        if (job.state !== 'generating') await store.transition(job.id, 'generating')
        console.log(`… ${job.momentId} 생성 중`)
      } else if (result.status === 'completed') {
        if (job.state !== 'ready') await store.transition(job.id, 'ready')
        const sha256 = createHash('sha256').update(await readFile(join(root, file))).digest('hex')
        await store.transition(job.id, 'downloaded', { file, sha256 })
        console.log(`✓ ${job.momentId} → ${file}`)
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

async function waitTakes(config, store) {
  const minutes = Number(rest[rest.indexOf('--minutes') + 1]) || 30
  const deadline = Date.now() + minutes * 60_000
  const interval = config.fake ? 100 : 10_000
  const plan = await loadPlan()
  while (Date.now() < deadline) {
    await pollTakes(config, store)
    // 앞 테이크가 끝나 이제 낼 수 있게 된 이어 찍기 테이크를 낸다.
    if (await hasWaitingTakes(plan, store)) await submitTakes(plan, config, store, { onlyNew: true })
    const open = (await store.list()).filter((job) => ['submitted', 'generating', 'unknown'].includes(job.state))
    if (open.length === 0 && !await hasWaitingTakes(plan, store)) {
      console.log('✓ 기다릴 테이크가 없다')
      return
    }
    await new Promise((resolve) => setTimeout(resolve, interval))
  }
  throw Object.assign(new Error(`${minutes}분 안에 끝나지 않았다 — 생성은 서버에서 계속된다. takes wait 를 다시 한다`), { exitCode: 2 })
}

// 아직 한 번도 내지 않았고, 시작 테이크가 실패로 끝나지 않은 테이크가 남았는가.
async function hasWaitingTakes(plan, store) {
  const jobs = await store.list()
  const settled = (id) => jobs.some((job) => job.momentId === id)
  const dead = (id) => jobs.some((job) => job.momentId === id) && !jobs.some((job) => job.momentId === id && job.state !== 'failed' && job.state !== 'blocked')
  return plan.moments.some((moment) => moment.kind === 'take' && !settled(moment.id) && !(moment.from?.take && dead(moment.from.take)))
}

async function sheet() {
  const input = join(root, 'out', flags.has('--draft') ? 'draft.mp4' : 'final.mp4')
  await contactSheet(input, join(root, 'out', 'contact.png'))
  console.log('✓ out/contact.png — 글자 겹침·안전 영역·가짜 글자·인물 일관성을 본다')
}

async function cuts() {
  if (!args[0]) throw new Error('usage: node tools/sd.mjs cuts <video file>')
  console.log(JSON.stringify({ file: args[0], cuts: await detectCuts(join(root, args[0])) }))
}

async function status() {
  const plan = await loadPlan()
  const jobs = await new JobStore(root).list()
  const has = async (file) => (await exists(join(root, file))) ? '✓' : '·'
  const takeMoments = plan.moments.filter((item) => item.kind === 'take')
  const downloaded = takeMoments.filter((moment) => jobs.some((job) => job.momentId === moment.id && job.state === 'downloaded')).length
  const validation = validatePlan(plan, { take: LTX_TAKE_SECONDS })
  const lines = [
    `# ${plan.title ?? '숏폼'} — 진행판`,
    '',
    `- ${validation.ok ? '✓' : '✗'} 기획 검증 (plan.json)`,
    `- ${await has('audio/narration.json')} 내레이션 (audio/narration.json)`,
    `- ${await has('out/draft.mp4')} 애니매틱 (out/draft.mp4)`,
    `- ${downloaded === takeMoments.length && takeMoments.length ? '✓' : '·'} 테이크 ${downloaded}/${takeMoments.length}`,
    `- ${await has('out/final.mp4')} 완성본 (out/final.mp4, 검수 대기)`,
    '',
    '| 테이크 | 상태 | 백엔드 | 메모 |',
    '|---|---|---|---|',
    ...jobs.map((job) => `| ${job.momentId} | ${job.state} | ${job.backend} | ${job.history.at(-1)?.reason ?? ''} |`),
    '',
  ]
  await writeFile(join(root, 'status.md'), lines.join('\n'))
  console.log(lines.join('\n'))
}

async function videoBackend(config) {
  if (config.fake) return fakeVideoBackend({ video: config.video })
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
