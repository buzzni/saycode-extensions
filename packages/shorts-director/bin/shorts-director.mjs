#!/usr/bin/env node
// 숏폼 총감독 도구(npx @buzzni/shorts-director). 현재 작업 폴더(프로젝트 루트)를 상태 저장소로 쓴다.
// 영상은 LTX 로컬 서버, 음성은 Qwen3-TTS 서버(주소·토큰은 .env). config/settings.json 의 fake: true 면 서버 없이 리허설한다.
import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { FONTS, MUSIC, ensureAsset } from '../lib/assets.mjs'
import { fakeSpeech, fakeVideoBackend } from '../lib/backends/fake.mjs'
import { LTX_TAKE_SECONDS, ltxVideoBackend } from '../lib/backends/ltx.mjs'
import { qwenSpeech } from '../lib/backends/qwen-tts.mjs'
import { hookLineOverrun, layoutNarration, scenesLongerThanSpeech, speechPastScene, speechTempo } from '../lib/captions.mjs'
import { loadConfig, loadEnv, loadTts, repositoryEnvFile, saveUserEnv, userConfigDir } from '../lib/config.mjs'
import { JobStore } from '../lib/jobs.mjs'
import { LOOKS } from '../lib/looks.mjs'
import { frames } from '../lib/formats.mjs'
import { writeChoices } from '../lib/choices.mjs'
import { changeTempo, detectCuts, extractFrame, probe, rhythmReport, run, tightenSpeech } from '../lib/media.mjs'
import { countTakes, planSeconds, validatePlan } from '../lib/plan.mjs'
import { postIssues, postMarkdown } from '../lib/post.mjs'
import { contactSheet, coverCandidates, renderCover, renderVideo } from '../lib/render.mjs'
import { ACTIVE_STATES, materialPath, resolveTakes, sha256 } from '../lib/takeState.mjs'
import { applyVariant } from '../lib/variants.mjs'
import { viewerScript } from '../lib/viewer.mjs'

const USAGE = 'usage: shorts-director <init [--ltx-url URL --tts-url URL] [--offline]|doctor|check|voice [--variant ID]|animatic|takes submit|takes poll|takes wait [--minutes N]|takes forget <id>|takes status|render [--variant ID]|sheet [--draft|--variant ID]|cover [--variant ID]|post [--variant ID]|cuts <file>|status|music|looks|formats|choices <frame/look> <frame/look>…|--version>'
const PACKAGE = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
const IGNORED = ['.env', 'knowledge/', '.work/', 'stills/', 'takes/', 'audio/', 'out/', 'jobs/']
const ENV_EXAMPLE = `# 이 프로젝트에서만 다른 서버를 쓸 때만 .env 로 복사해 채운다(.env 는 커밋하지 않는다).
# 보통은 작업 환경이 저장소 루트 .env 에 써 주거나, shorts-director init --ltx-url <주소> --tts-url <주소> 로
# 이 PC 에 한 번 저장하면 된다(~/.config/shorts-director/.env). 토큰은 ~/.config/shorts-director/tts-token 에 한 줄로 둔다.
LTX_URL=http://<영상 서버>:8010
QWEN_TTS_URL=http://<음성 서버>:8765
# QWEN_TTS_TOKEN=
`
const root = process.cwd()
const [command, ...rest] = process.argv.slice(2)
const flags = new Set(rest.filter((arg) => arg.startsWith('--')))
const args = rest.filter((arg) => !arg.startsWith('--'))

const commands = { init, doctor, check, voice, animatic, takes, render, sheet, cover, post, cuts, status, music, looks, formats, choices }

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
  if (!flags.has('--offline')) await fetchFonts()
  console.log('다음: shorts-director doctor')
}

// 글꼴(Pretendard, OFL)은 이 PC 에 한 번 받아 둔다. 받지 못해도 시스템 글꼴로 계속한다.
async function fetchFonts() {
  try {
    for (const font of FONTS) await ensureAsset(font, join(userConfigDir(), 'fonts'))
    console.log(`✓ 글꼴 ${FONTS.map((font) => font.name).join(', ')} (SIL OFL 1.1) — ${join(userConfigDir(), 'fonts')}`)
  } catch (error) {
    console.log(`! 글꼴을 받지 못했다(${error.message}) — 시스템 글꼴로 그린다. 다시 받으려면 init 을 한 번 더 한다.`)
  }
}

// 기획에서 고를 수 있는 글자 디자인 묶음. 한 편은 묶음 하나로 통일한다.
async function looks() {
  console.log('글자 디자인 묶음 — plan.json 에 "look": "<id>" 로 고른다(없으면 clean). 묶음의 글꼴(SIL OFL)은 처음 render 할 때 받는다')
  for (const [id, look] of Object.entries(LOOKS)) console.log(`${id.padEnd(8)}${look.suits}`)
}

// 화면 형식. full(기본, 그림이 뜻을 실을 때) 또는 band(가운데 창 + 영상 내내 남는 위 제목 + 아래 자막, 글자가 뜻을 실을 때)와 그 틀.
async function formats() {
  console.log('화면 형식 — 그림이 뜻을 실으면 full(기본, 생략), 글자가 뜻을 실으면(단계·목록·정보·앱 화면) band')
  console.log('  "format": { "layout": "band", "frame": "<id>", "headline": { "text": "영상 내내 남는 제목", "emphasis": "낱말" } }')
  console.log('  장면마다 "badge": "1" 로 창 모서리에 단계·순위 번호를 띄운다')
  console.log('band 틀:')
  for (const frame of frames()) console.log(`${frame.id.padEnd(18)}${frame.content === 'portrait' ? '세로 창 ' : '정사각 창'}  ${frame.suits}`)
}

// 인터뷰용 디자인 비교: 후보(<틀 id 또는 full>/<look>)마다 이 영상의 위 제목·첫 그림·첫 말 한 줄을 얹은 한 장.
async function choices() {
  const results = await writeChoices({ root, plan: await loadPlan(), config: await loadConfig(root), args: rest })
  for (const result of results) console.log(`${result.label} · ${result.frame === 'full' ? '전체 화면' : result.frame} · ${result.look} → out/choices/${result.label}.png`)
  console.log('✓ out/choices.png (나란히) · out/choices.html (이름표 붙은 비교 화면) — 인터뷰 선택지의 A·B·C 와 같다')
}

// 기획에서 고를 수 있는 배경음(CC0) 목록. 곡은 처음 render 할 때 이 PC 에 받는다.
async function music() {
  console.log('배경음(CC0 공개 도메인, 출처: FreePD.com) — plan.json 에 "music": { "track": "<id>" } 로 고른다')
  for (const [id, track] of Object.entries(MUSIC)) console.log(`${id.padEnd(18)}${track.mood}`)
}

function optionValue(name) {
  const index = rest.indexOf(name)
  return index >= 0 ? rest[index + 1] : undefined
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
  const repositoryEnv = await repositoryEnvFile(root)
  const repositoryNote = repositoryEnv && !await exists(repositoryEnv) ? ' (파일 없음)' : ''
  console.log(`· 저장소 루트 .env: ${repositoryEnv ? `${repositoryEnv}${repositoryNote}` : '찾지 못함(.git 이 있는 상위 폴더가 없다)'}`)
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
  if (!url) return [false, `${name}: 주소가 없다 — shorts-director init --ltx-url <주소> --tts-url <주소> 로 이 PC 에 한 번 저장하거나 프로젝트 .env(작업 폴더나 저장소 루트)에 ${name.startsWith('LTX') ? 'LTX_URL' : 'QWEN_TTS_URL'} 를 넣는다`]
  try {
    const response = await fetch(`${url.replace(/\/+$/, '')}${path}`, { headers, signal: AbortSignal.timeout(10_000) })
    const json = await response.json().catch(() => ({}))
    if (response.status === 401) return [false, `${name}: 토큰이 없거나 틀렸다 — 저장소 루트 .env 의 QWEN_TTS_TOKEN 이나 ~/.config/shorts-director/tts-token(한 줄)을 확인한다`]
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
  const cut = await loadCut()
  // 글·목소리·빠르기 설정이 같은 줄은 다시 읽지 않는다. TTS 는 같은 문장도 읽을 때마다 길이가 크게 달라(실측 2.8~6.9초) 한 줄을
  // 고칠 때마다 전부 다시 읽으면 맞춰 둔 다른 줄이 흔들린다. 변형은 기본판 녹음도 쓴다. --fresh [줄,줄] 은 그 줄(없으면 전부)을 새로 읽는다.
  const previous = async (file) => readFile(join(root, file), 'utf8').then((text) => JSON.parse(text).lines ?? [], () => [])
  const reuse = [...await previous(cut.narrationFile), ...(cut.id ? await previous(join('audio', 'narration.json')) : [])]
  const fresh = optionValue('--fresh')
  const again = !flags.has('--fresh') ? new Set() : /^\d+(,\d+)*$/.test(fresh ?? '') ? new Set(fresh.split(',').map(Number)) : 'all'
  await recordNarration(cut.plan, { directory: cut.voiceDirectory, output: cut.narrationFile, reuse: again === 'all' ? [] : reuse, again: again === 'all' ? new Set() : again })
}

// 내레이션을 읽어 침묵을 자르고 빠르기를 맞춘 뒤 실측 길이로 배치한다. directory 에 줄마다 wav, output 에 배치(JSON)를 쓴다.
// reuse 의 녹음 중 같은 voice 키(글·목소리·설정)인 것은 다시 읽지 않는다. again 의 줄 번호는 키가 같아도 새로 읽는다.
async function recordNarration(plan, { directory, output, reuse = [], again = new Set() }) {
  const config = await loadConfig(root)
  const tts = config.fake ? {} : await loadTts(root)
  const speak = config.fake ? fakeSpeech : qwenSpeech({ baseUrl: tts.url, token: tts.token })
  await mkdir(join(root, directory), { recursive: true })
  const measured = []
  for (const [index, line] of (plan.narration ?? []).entries()) {
    const name = String(index).padStart(2, '0')
    const minStart = line.moment ? momentStart(plan, line.moment) + config.voice.start : undefined
    const speaker = line.speaker ?? config.voice.speaker
    const key = sha256(JSON.stringify([line.text, speaker, config.voice.language, config.voice.syllablesPerSecond, config.voice.maxTempo])).slice(0, 12)
    const same = again.has(index) ? undefined : await firstExisting(reuse.filter((entry) => entry.voice === key))
    if (same) {
      measured.push({ text: line.text, file: same.file, seconds: same.seconds, tempo: same.tempo, voice: key, ...(line.moment ? { moment: line.moment } : {}), ...(minStart === undefined ? {} : { minStart }) })
      console.log(`↺ ${name} ${same.seconds}초 (${same.file.startsWith(directory) ? '이전 녹음' : '기본판 녹음'}) — ${line.text}`)
      continue
    }
    // 파일 이름에 키를 넣는다 — 줄 순서가 바뀌어도 아직 쓰는 다른 줄의 녹음을 덮어쓰지 않게.
    const raw = join(root, directory, `${name}-${key}.raw.wav`)
    const file = join(directory, `${name}-${key}${again.has(index) ? `-${Date.now().toString(36)}` : ''}.wav`)
    await speak(raw, { text: line.text, language: config.voice.language, speaker })
    const tight = join(root, directory, `${name}-${key}.tight.wav`)
    await tightenSpeech(raw, tight)
    const tempo = speechTempo(line.text, (await probe(tight)).duration, { target: config.voice.syllablesPerSecond, max: config.voice.maxTempo })
    await changeTempo(tight, join(root, file), tempo)
    await rm(tight, { force: true })
    measured.push({
      text: line.text,
      file,
      voice: key,
      seconds: Math.round((await probe(join(root, file))).duration * 1000) / 1000,
      tempo: Math.round(tempo * 100) / 100,
      ...(line.moment ? { moment: line.moment } : {}),
      ...(minStart === undefined ? {} : { minStart }),
    })
    console.log(`✓ ${name} ${measured.at(-1).seconds}초${tempo > 1 ? ` (${measured.at(-1).tempo}배속)` : ''} — ${line.text}`)
  }
  const lines = layoutNarration(measured, { start: config.voice.start, gap: config.voice.gap })
  const total = planSeconds(plan)
  const end = lines.at(-1)?.end ?? 0
  await writeFile(join(root, output), `${JSON.stringify({ lines, end, videoSeconds: total }, null, 2)}\n`)
  console.log(`✓ 내레이션 ${lines.length}줄 · 끝 ${end}초 / 영상 ${total}초`)
  const hookLine = hookLineOverrun(plan, lines)
  if (hookLine) console.log(`! 첫 줄이 ${hookLine.end}초에 끝난다 — "${hookLine.text}" 훅은 3초 안에 다 들려야 한다. 한 호흡(12음절 안팎)으로 줄이고 나머지는 다음 줄로 넘긴다.`)
  for (const scene of scenesLongerThanSpeech(plan, lines)) {
    console.log(`! ${scene.id} 장면이 말보다 ${scene.idle}초 길다 — 빈 소리 구간이 된다. 테이크를 만들기 전에 장면을 줄이거나 말을 늘린다.`)
  }
  for (const scene of speechPastScene(plan, lines)) {
    console.log(`! ${scene.id} 장면의 말이 ${scene.into} 장면으로 ${scene.over}초 넘어간다 — "${scene.text}" 자막 끝이 ${scene.into} 화면 위에 뜨고 ${scene.into} 의 말이 늦게 시작한다. 그 줄을 줄이거나 ${scene.id} 장면을 늘린다.`)
  }
  if (end > total - 0.2) console.log(`! 내레이션이 영상보다 ${Math.round((end - total + 0.2) * 10) / 10}초 길다 — 문장을 줄이거나 장면을 늘린다.`)
}

async function animatic() {
  const out = join(root, 'out', 'draft.mp4')
  const result = await renderVideo({ root, plan: await loadPlan(), config: await loadConfig(root), mode: 'draft', narration: await loadNarration(), out })
  console.log(`✓ 애니매틱 ${result.seconds}초 → out/draft.mp4 (영상 생성 없음)`)
}

async function render() {
  const cut = await loadCut()
  const plan = cut.plan
  const config = await loadConfig(root)
  const entries = await resolveTakes(root, plan, config, await new JobStore(root).list())
  const missing = [...entries.values()].filter((entry) => !entry.done).map((entry) => entry.moment.id)
  if (missing.length) throw Object.assign(new Error(`지금 기획에 맞는 테이크가 아직 없다: ${missing.join(', ')} — takes submit / takes wait 를 먼저 한다`), { exitCode: 2 })
  // takes/ 의 파일이 지금 기획의 결과가 아니면(다른 버전) 그 작업의 결과로 되돌린다.
  for (const entry of entries.values()) await placeTake(entry.moment.id, entry.done)
  if (cut.id && plan.narration?.length && !await exists(join(root, cut.narrationFile))) {
    throw Object.assign(new Error(`${cut.label} 의 내레이션이 없다 — voice --variant ${cut.id} 를 먼저 한다`), { exitCode: 2 })
  }
  const narration = await loadNarration(cut.narrationFile)
  const result = await renderVideo({ root, plan, config, mode: 'final', narration, out: join(root, cut.final), name: `final${cut.suffix}`, checkFile: `text-check${cut.suffix}.json` })
  console.log(`✓ ${cut.label} ${result.seconds}초 → ${cut.final} (검수 대기) · 효과음 ${result.sounds}개${plan.music ? '' : ' · 배경음 없음(plan.music)'}`)
  if (cut.hypothesis) console.log(`  비교할 것: ${cut.hypothesis}`)
  await writeFile(join(root, cut.viewer), viewerScript(plan, narration, { label: cut.label, sheet: cut.sheet }))
  console.log(`  ${cut.viewer} — 시청자에게 닿는 것(시간순 화면·글자·말). sheet 로 ${cut.sheet} 를 만든 뒤 완성본 시청자 점검에 함께 넘긴다`)
  const out = join(root, cut.final)
  const planned = plan.moments.reduce((sum, moment) => sum + Math.max(1, (moment.shots ?? []).length), 0) - 1
  // 펀치인은 장면 점수가 낮아(실측 0.08~0.22) 감지 기준 0.3 에 걸리지 않는다 — 렌더러가 넣은 컷을 합쳐 센다.
  const detected = await detectCuts(out)
  const cuts = [...detected, ...result.edits.filter((at) => at > 0 && !detected.some((cut) => Math.abs(cut - at) < 0.25))].sort((left, right) => left - right)
  const rhythm = rhythmReport(cuts, result.seconds, planned)
  console.log(`  컷 ${rhythm.cuts}개(기획 ${rhythm.planned}개) · 가장 긴 장면 ${rhythm.longest.seconds}초(${rhythm.longest.start}~${rhythm.longest.end}초)`)
  if (rhythm.longest.seconds > 4) console.log(`! ${rhythm.longest.start}~${rhythm.longest.end}초가 한 화면으로 ${rhythm.longest.seconds}초 이어진다 — 장면을 나누거나 클로즈업·사진·문구 화면을 끼운다.`)
  if (rhythm.cuts < rhythm.planned * 0.6) console.log('! 기획한 컷보다 실제 컷이 적다 — 이어 찍은 장면이 한 화면처럼 보이는지 확인한다.')
  for (const entry of result.moved) {
    console.log(`  자동 배치: ${entry.start}초 "${entry.text}" — 얼굴·주인공을 비켜 위에서 ${entry.from} → ${entry.to}${entry.scale === 1 ? '' : ` (글자 ${Math.round(entry.scale * 100)}%)`}. 그 자리가 싫으면 caption.position 을 적는다`)
  }
  const WHAT = { face: '얼굴을', subject: '주인공 사물 가운데를' }
  for (const entry of result.placement) {
    const issues = entry.problems.map((problem) => (problem.kind === 'edge' ? '화면 가장자리에 닿음' : `${WHAT[problem.kind]} ${Math.round(problem.share * 100)}% 가림`))
    console.log(`! ${entry.start}초 "${entry.text}" — ${issues.join(', ')}. caption.position(y·x)이나 look 으로 옮기고 render 를 다시 한다(out/text-check${cut.suffix}.json).`)
  }
  if (result.placement.length === 0) console.log('  화면 문구: 얼굴·주인공 가림 없음')
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
  const cut = await loadCut()
  const input = flags.has('--draft') ? join('out', 'draft.mp4') : cut.final
  const { times, columns } = await contactSheet(join(root, input), join(root, cut.sheet), { config: await loadConfig(root), root })
  console.log(`✓ ${cut.sheet} — 글자 겹침·안전 영역·가짜 글자·인물 일관성을 본다. 칸마다 시각을 왼쪽 위에 적었다:`)
  for (let row = 0; row * columns < times.length; row += 1) console.log(`  ${row + 1}행: ${times.slice(row * columns, (row + 1) * columns).map((at) => `${at}초`).join(' · ')}`)
}

// 표지 후보: 얼굴·주인공이 크고 선명한 순간 셋을 시각과 함께 보인다(out/cover-candidates.png). 하나를 골라 plan.cover.at 에 적는다.
async function cover() {
  const cut = await loadCut()
  const source = await renderedBase(cut)
  const out = join('out', `cover-candidates${cut.suffix}.png`)
  const picks = await coverCandidates({ root, plan: cut.plan, config: await loadConfig(root), base: source, out: join(root, out) })
  if (picks.length === 0) throw new Error('표지로 쓸 만한 얼굴·주인공 장면을 찾지 못했다 — 직접 cover.at 을 고른다')
  const WHAT = { face: '얼굴', subject: '주인공 사물' }
  for (const pick of picks) console.log(`· ${pick.at}초 — ${WHAT[pick.kind]} 화면의 ${Math.round(pick.area * 100)}%`)
  console.log(`✓ ${out} — 셋을 이미지로 보고 영상이 무엇인지(주제 사물·결과) 가장 잘 보이는 순간을 cover.at 에 적는다`)
}

// 글자를 얹기 전의 조립 화면. 변형도 테이크가 같으니 기본판 조립 결과를 쓸 수 있다.
async function renderedBase(cut) {
  for (const name of [`final${cut.suffix}`, 'final']) {
    const file = join(root, '.work', name, 'base.mp4')
    if (await exists(file)) return file
  }
  throw Object.assign(new Error('표지를 뽑을 조립 결과가 없다 — render 를 먼저 한다'), { exitCode: 2 })
}

// 올릴 글(out/post.md)과 표지(out/cover.jpg). 게시는 하지 않는다 — 사람이 검수하고 올린다.
async function post() {
  const cut = await loadCut()
  const { plan } = cut
  if (!plan.post && !plan.cover) throw new Error('plan.json 에 post(플랫폼별 제목·설명·해시태그)나 cover(표지 시각·문구)가 없다')
  const problems = postIssues(plan)
  for (const issue of problems) console.log(`${issue.level === 'error' ? '✗' : '!'} ${issue.code}${issue.where ? ` (${issue.where})` : ''}: ${issue.message}`)
  if (problems.some((issue) => issue.level === 'error')) process.exit(1)
  await mkdir(join(root, 'out'), { recursive: true })
  if (plan.post) {
    await writeFile(join(root, cut.post), postMarkdown(plan, { cover: cut.cover }))
    console.log(`✓ ${cut.post} — 플랫폼별 제목·설명·해시태그. 검수한 뒤 사람이 올린다`)
  }
  if (plan.cover) {
    const { problems, moved } = await renderCover({ root, plan, config: await loadConfig(root), base: await renderedBase(cut), out: join(root, cut.cover) })
    console.log(`✓ ${cut.cover} — ${plan.cover.at}초 화면에 "${plan.cover.text}". 피드·프로필 격자(가운데 3:4)에서 읽히는지 본다`)
    if (moved) console.log(`  자동 배치: 표지 문구 — 얼굴·주인공을 비켜 위에서 ${moved.from} → ${moved.to}${moved.scale === 1 ? '' : ` (글자 ${Math.round(moved.scale * 100)}%)`}. 그 자리가 싫으면 cover.position 을 적는다`)
    const WHAT = { face: '얼굴을', subject: '주인공 사물 가운데를' }
    const issues = problems.map((problem) => (problem.kind === 'edge' ? '화면 가장자리에 닿음' : `${WHAT[problem.kind]} ${Math.round(problem.share * 100)}% 가림`))
    console.log(issues.length ? `! 표지 문구 "${plan.cover.text}" — ${issues.join(', ')}. cover.position(y·x)이나 look 으로 옮기거나 cover.at 을 바꾸고 post 를 다시 한다.` : '  표지 문구: 얼굴·주인공 가림 없음')
  }
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
      ...(plan.post || plan.cover ? [`- ${await has('out/post.md')} 올릴 글 (out/post.md${plan.cover ? ', out/cover.jpg' : ''})`] : []),
      ...await Promise.all((plan.variants ?? []).map(async (variant) => `- ${await has(`out/final-${variant.id}.mp4`)} 변형 ${variant.id} (out/final-${variant.id}.mp4) — ${variant.hypothesis ?? ''}`)),
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

async function loadNarration(file = join('audio', 'narration.json')) {
  try {
    return JSON.parse(await readFile(join(root, file), 'utf8')).lines
  } catch {
    return []
  }
}

// --variant <id> 가 있으면 그 변형을 덮어쓴 기획과 그 변형의 파일 이름들, 없으면 기본판.
async function loadCut() {
  const plan = await loadPlan()
  const id = optionValue('--variant')
  if (flags.has('--variant') && !id) throw new Error('usage: --variant <plan.variants 의 id>')
  if (!id) {
    return { plan, suffix: '', label: '완성본', voiceDirectory: join('audio', 'narration'), narrationFile: join('audio', 'narration.json'),
      final: join('out', 'final.mp4'), viewer: join('out', 'viewer.md'), sheet: join('out', 'contact.png'), post: join('out', 'post.md'), cover: join('out', 'cover.jpg') }
  }
  const variant = (plan.variants ?? []).find((item) => item.id === id)
  if (!variant) throw new Error(`plan.variants 에 ${id} 가 없다 — 있는 변형: ${(plan.variants ?? []).map((item) => item.id).join(', ') || '없음'}`)
  const suffix = `-${id}`
  return { id, plan: applyVariant(plan, id), suffix, label: `변형 ${id}`, hypothesis: variant.hypothesis,
    voiceDirectory: join('audio', 'variants', id), narrationFile: join('audio', 'variants', id, 'narration.json'),
    final: join('out', `final${suffix}.mp4`), viewer: join('out', `viewer${suffix}.md`), sheet: join('out', `contact${suffix}.png`),
    post: join('out', `post${suffix}.md`), cover: join('out', `cover${suffix}.jpg`) }
}

function printJobs(jobs) {
  if (jobs.length === 0) return console.log('테이크 작업이 없다')
  for (const job of jobs) console.log(`${job.momentId}\t${job.state}\t${job.backend}\t${job.remoteId ?? ''}`)
}

async function firstExisting(entries) {
  for (const entry of entries) if (entry.file && await exists(join(root, entry.file))) return entry
  return undefined
}

async function exists(path) {
  return access(path).then(() => true, () => false)
}
