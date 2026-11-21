#!/usr/bin/env node
// 숏폼 총감독 도구. 현재 작업 폴더(프로젝트 루트)를 상태 저장소로 쓴다.
// 사용법: node tools/sd.mjs <check|stills|voice|animatic|takes submit|takes poll|takes status|render|sheet|cuts <file>|status>
import { createHash } from 'node:crypto'
import { access, copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { geminiImage, geminiSpeech, geminiVideoBackend, isQuotaError } from './lib/backends/gemini-omni-api.mjs'
import { fakeImage, fakeSpeech, fakeVideoBackend } from './lib/backends/fake.mjs'
import { routeBackend } from './lib/budget.mjs'
import { layoutNarration } from './lib/captions.mjs'
import { loadConfig, loadEnv } from './lib/config.mjs'
import { createGeminiClient } from './lib/gemini.mjs'
import { JobStore } from './lib/jobs.mjs'
import { detectCuts, probe } from './lib/media.mjs'
import { countTakes, planSeconds, validatePlan } from './lib/plan.mjs'
import { contactSheet, renderVideo } from './lib/render.mjs'
import { buildTake } from './lib/takes.mjs'

const root = process.cwd()
const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const args = rest.filter((arg) => !arg.startsWith('--'))

const commands = { check, stills, voice, animatic, takes, render, sheet, cuts, status }

try {
  if (!commands[command]) {
    console.log('usage: node tools/sd.mjs <check|stills|voice|animatic|takes submit|takes poll|takes status|render|sheet|cuts <file>|status>')
    process.exit(command ? 1 : 0)
  }
  await commands[command]()
} catch (error) {
  console.error(`✗ ${error.message}`)
  process.exit(error.exitCode ?? 1)
}

async function check() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const result = validatePlan(plan)
  for (const issue of result.issues) console.log(`${issue.level === 'error' ? '✗' : '!'} ${issue.code}${issue.where ? ` (${issue.where})` : ''}: ${issue.message}`)
  const errors = result.issues.filter((issue) => issue.level === 'error').length
  console.log(`오류 ${errors} · 경고 ${result.issues.length - errors} · 길이 ${planSeconds(plan)}초 · 테이크 ${countTakes(plan)}개`)
  console.log(`영상 백엔드 예상: ${routeFor(plan, config).reason}`)
  if (errors) process.exit(1)
}

async function stills() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const client = config.fake ? undefined : await gemini()
  await mkdir(join(root, 'stills'), { recursive: true })
  const sheetOf = (id) => join(root, 'stills', `${id}-sheet.png`)

  for (const subject of plan.subjects ?? []) {
    const out = sheetOf(subject.id)
    if (!flags.has('--force') && await exists(out)) continue
    const prompt = subject.kind === 'person'
      ? `Character reference sheet of ${subject.look}. Front view and three-quarter view side by side, full body, plain light grey background, soft natural light, photorealistic. No text.`
      : `Reference sheet of ${subject.look}. Front and three-quarter views on a plain light grey background, soft natural light, photorealistic. No text.`
    await draw(client, config, out, { prompt, aspect: '1:1', refs: [], seed: subject.id })
    console.log(`✓ ${subject.id} 시트`)
  }
  for (const moment of plan.moments.filter((item) => item.kind === 'take' && item.first_frame)) {
    const out = join(root, 'stills', `${moment.id}.png`)
    if (!flags.has('--force') && await exists(out)) continue
    const refs = (moment.subjects ?? []).map(sheetOf)
    const prompt = `${moment.first_frame.prompt}\nThis is the first frame of a vertical 9:16 phone video. Keep every person and object exactly as in the reference sheets. No text.`
    await draw(client, config, out, { prompt, aspect: config.aspect, refs, seed: moment.id })
    console.log(`✓ ${moment.id} 첫 프레임`)
  }
}

async function voice() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const client = config.fake ? undefined : await gemini()
  await mkdir(join(root, 'audio', 'narration'), { recursive: true })
  const measured = []
  for (const [index, line] of (plan.narration ?? []).entries()) {
    const file = join('audio', 'narration', `${String(index).padStart(2, '0')}.wav`)
    if (config.fake) await fakeSpeech(join(root, file), line.text)
    else await geminiSpeech(client, join(root, file), { text: line.text, voice: line.voice ?? config.voice.voice, style: line.style ?? config.voice.style })
    measured.push({ text: line.text, file, seconds: Math.round((await probe(join(root, file))).duration * 1000) / 1000 })
  }
  const lines = layoutNarration(measured, { start: config.voice.start, gap: config.voice.gap })
  const total = planSeconds(plan)
  const end = lines.at(-1)?.end ?? 0
  await writeFile(join(root, 'audio', 'narration.json'), `${JSON.stringify({ lines, end, videoSeconds: total }, null, 2)}\n`)
  console.log(`✓ 내레이션 ${lines.length}줄 · 끝 ${end}초 / 영상 ${total}초`)
  if (end > total - 0.2) console.log(`! 내레이션이 영상보다 ${Math.round((end - total + 0.2) * 10) / 10}초 길다 — 문장을 줄이거나 장면을 늘린다(TTS 속도를 올리지 않는다).`)
}

async function animatic() {
  const out = join(root, 'out', 'draft.mp4')
  const result = await renderVideo({ root, plan: await loadPlan(), config: await loadConfig(root), mode: 'draft', narration: await loadNarration(), out })
  console.log(`✓ 애니매틱 ${result.seconds}초 → out/draft.mp4 (한도 0)`)
}

async function render() {
  const plan = await loadPlan()
  const missing = []
  for (const moment of plan.moments.filter((item) => item.kind === 'take')) {
    if (!await exists(join(root, 'takes', `${moment.id}.mp4`))) missing.push(moment.id)
  }
  if (missing.length) throw Object.assign(new Error(`테이크가 아직 없다: ${missing.join(', ')} — takes submit / takes poll 을 먼저 한다`), { exitCode: 2 })
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
  throw new Error(`unknown takes command: ${sub}`)
}

async function submitTakes(plan, config, store) {
  const route = routeFor(plan, config)
  if (route.backend === 'wait') throw Object.assign(new Error(`지금은 만들 수 없다: ${route.reason}`), { exitCode: 2 })
  if (route.backend === 'gemini-app') throw Object.assign(new Error('Gemini 앱 백엔드는 실측(Phase 0b) 전이라 아직 연결돼 있지 않다'), { exitCode: 2 })
  if (route.needsApproval && !flags.has('--approve')) {
    console.log(`${route.reason}\n예상 비용 약 $${route.estimatedUsd} (테이크 ${countTakes(plan)}개, ${config.video.api.resolution}).`)
    console.log('사용자 승인 후 --approve 를 붙여 다시 실행한다.')
    process.exit(3)
  }
  const backend = await videoBackend(route.backend, config)
  await mkdir(join(root, 'takes'), { recursive: true })
  for (const moment of plan.moments.filter((item) => item.kind === 'take')) {
    const take = buildTake(moment, config)
    const target = join(root, 'takes', `${moment.id}.mp4`)
    const reusable = await store.findReusable(take)
    if (reusable) {
      if (!await exists(target)) await copyFile(join(root, reusable.file), target)
      console.log(`↺ ${moment.id} 재사용 (${reusable.id})`)
      continue
    }
    const job = await store.create(take, backend.name)
    await store.transition(job.id, 'submitting')
    try {
      const submitted = await backend.submit(take, { root, config })
      await store.transition(job.id, 'submitted', { remoteId: submitted.remoteId })
      console.log(`→ ${moment.id} 제출 (${backend.name}, ${submitted.remoteId})`)
    } catch (error) {
      const state = isQuotaError(error) ? 'quota_exhausted' : error.name === 'TimeoutError' ? 'unknown' : 'failed'
      await store.transition(job.id, state, { reason: error.message })
      console.log(`✗ ${moment.id} ${state}: ${error.message}`)
      if (state !== 'failed') break
    }
  }
}

async function pollTakes(config, store) {
  const active = (await store.list()).filter((job) => ['submitted', 'generating', 'unknown'].includes(job.state) && job.remoteId)
  for (const job of active) {
    const backend = await videoBackend(job.backend, config)
    const file = join('takes', `${job.momentId}.mp4`)
    try {
      const result = await backend.poll(job, { root, config, saveTo: join(root, file) })
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
      console.log(`? ${job.momentId} 확인 실패(다시 poll 한다, 다시 제출하지 않는다): ${error.message}`)
    }
  }
  if (active.length === 0) console.log('확인할 테이크가 없다')
}

async function sheet() {
  const input = join(root, 'out', flags.has('--draft') ? 'draft.mp4' : 'final.mp4')
  await contactSheet(input, join(root, 'out', 'contact.png'))
  console.log('✓ out/contact.png — 자막 겹침·안전 영역·워터마크를 본다')
}

async function cuts() {
  if (!args[0]) throw new Error('usage: node tools/sd.mjs cuts <video file>')
  console.log(JSON.stringify({ file: args[0], cuts: await detectCuts(join(root, args[0])) }))
}

async function status() {
  const plan = await loadPlan()
  const config = await loadConfig(root)
  const jobs = await new JobStore(root).list()
  const has = async (file) => (await exists(join(root, file))) ? '✓' : '·'
  const takeMoments = plan.moments.filter((item) => item.kind === 'take')
  const downloaded = takeMoments.filter((moment) => jobs.some((job) => job.momentId === moment.id && job.state === 'downloaded')).length
  const validation = validatePlan(plan)
  const route = routeFor(plan, config)
  const lines = [
    `# ${plan.title ?? '숏폼'} — 진행판`,
    '',
    `- ${validation.ok ? '✓' : '✗'} 기획 검증 (plan.json)`,
    `- ${await has('audio/narration.json')} 내레이션 (audio/narration.json)`,
    `- ${await has('out/draft.mp4')} 애니매틱 (out/draft.mp4, 한도 0)`,
    `- ${downloaded === takeMoments.length && takeMoments.length ? '✓' : '·'} 테이크 ${downloaded}/${takeMoments.length}`,
    `- ${await has('out/final.mp4')} 완성본 (out/final.mp4, 검수 대기)`,
    '',
    `영상 백엔드: ${route.reason}${route.estimatedUsd ? ` · 예상 $${route.estimatedUsd}` : ''}`,
    '',
    '| 테이크 | 상태 | 백엔드 | 메모 |',
    '|---|---|---|---|',
    ...jobs.map((job) => `| ${job.momentId} | ${job.state} | ${job.backend} | ${job.history.at(-1)?.reason ?? ''} |`),
    '',
  ]
  await writeFile(join(root, 'status.md'), lines.join('\n'))
  console.log(lines.join('\n'))
}

function routeFor(plan, config) {
  const seconds = plan.moments.filter((item) => item.kind === 'take').map((item) => Number(item.seconds))
  return routeBackend({ takes: seconds, app: config.video.app, api: config.video.api, autopilot: config.autopilot, fake: config.fake })
}

async function videoBackend(name, config) {
  if (name === 'fake') return fakeVideoBackend
  if (name === 'gemini-omni-api') return geminiVideoBackend(await gemini())
  throw new Error(`unknown video backend ${name}`)
}

async function draw(client, config, out, { prompt, aspect, refs, seed }) {
  if (config.fake) return fakeImage(out, { width: config.width, height: aspect === '1:1' ? config.width : config.height, seed })
  return geminiImage(client, out, { prompt, aspect, refs })
}

async function gemini() {
  const env = await loadEnv(root)
  return createGeminiClient({ apiKey: env.GEMINI_API_KEY })
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

