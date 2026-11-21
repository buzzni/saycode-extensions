// 가짜 백엔드로 ①~⑩ 전체 흐름을 실제 ffmpeg 와 글자 렌더러로 돌린다. 영상·음성 서버 호출 없음.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = new URL('../bin/shorts-director.mjs', import.meta.url).pathname
const canRender = await Promise.all([exec('ffmpeg', ['-version']), exec('osascript', ['-e', '1'])]).then(() => true, () => false)

function plan() {
  const shots = (count, seconds) => Array.from({ length: count }, (_, index) => ({ seconds, framing: `f${index}`, action: 'a' }))
  return {
    version: 1,
    title: '테스트',
    language: 'ko',
    aspect: '9:16',
    target_seconds: 12,
    hook: { options: [{ line: 'A', mechanism: 'loss', question: 'a?' }, { line: 'B', mechanism: 'gap', question: 'b?' }, { line: 'C', mechanism: 'situation', question: 'c?' }], chosen: 0 },
    subjects: [{ id: 'hero', kind: 'person', look: 'a woman in a beige trench coat' }],
    moments: [
      { id: 'm1', kind: 'take', place: 'subway exit', seconds: 4, subjects: ['hero'], shots: shots(2, 2), video_prompt: 'she runs into the rain', caption: { text: '우산 없이 나왔다', role: 'hook' } },
      { id: 'm2', kind: 'photo', file: 'materials/photo.png', seconds: 3, shots: shots(1, 3) },
      { id: 'm3', kind: 'take', place: 'bus stop', seconds: 3, subjects: ['hero'], from: { take: 'm1' }, shots: shots(1, 3), video_prompt: 'she walks on to the bus stop' },
      { id: 'm4', kind: 'card', seconds: 2, shots: shots(1, 2), caption: { text: '오늘 밤 비 90%', role: 'info' } },
    ],
    narration: [{ text: '우산 없이 나와 본 적 있죠?' }, { text: '오늘이 그날이에요.' }],
  }
}

async function run(cwd, ...args) {
  return exec(process.execPath, [cli, ...args], { cwd, maxBuffer: 10 * 1024 * 1024 })
}

async function exists(path) {
  return access(path).then(() => true, () => false)
}

async function probe(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file])
  return JSON.parse(stdout)
}

test('the full pipeline renders a draft and a final short with fake backends', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-pipeline-'))
  try {
    await mkdir(join(root, 'materials'), { recursive: true })
    await mkdir(join(root, 'config'), { recursive: true })
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=640x960', '-frames:v', '1', join(root, 'materials/photo.png')])
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan(), null, 2))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))

    const doctor = await run(root, 'doctor')
    assert.match(doctor.stdout, /가짜 백엔드 모드/)
    const check = await run(root, 'check')
    assert.match(check.stdout, /오류 0/)

    const voice = await run(root, 'voice')
    assert.match(voice.stdout, /내레이션 2줄/)
    const narration = JSON.parse(await readFile(join(root, 'audio/narration.json'), 'utf8'))
    assert.equal(narration.lines.length, 2)
    assert.ok(narration.lines[1].start > narration.lines[0].end)

    await run(root, 'animatic')
    const draft = await probe(join(root, 'out/draft.mp4'))
    assert.ok(Math.abs(Number(draft.format.duration) - 12) < 0.3, `draft duration ${draft.format.duration}`)

    const submit = await run(root, 'takes', 'submit')
    assert.match(submit.stdout, /fake/)
    assert.match(submit.stdout, /m3 대기 — m1/, 'a chained take waits for the take it starts from')
    const wait = await run(root, 'takes', 'wait')
    assert.match(wait.stdout, /기다릴 테이크가 없다/)
    for (const id of ['m1', 'm3']) assert.ok(await exists(join(root, `takes/${id}.mp4`)), id)
    assert.ok(await exists(join(root, 'stills/m3-first.png')), 'the first frame of m3 is the last frame of m1')
    const resubmit = await run(root, 'takes', 'submit')
    assert.match(resubmit.stdout, /재사용/)

    await run(root, 'render')
    const final = await probe(join(root, 'out/final.mp4'))
    assert.ok(Math.abs(Number(final.format.duration) - 12) < 0.3, `final duration ${final.format.duration}`)
    const video = final.streams.find((stream) => stream.codec_type === 'video')
    assert.deepEqual([video.width, video.height], [270, 480])
    assert.ok(final.streams.some((stream) => stream.codec_type === 'audio'))

    await run(root, 'sheet')
    assert.ok(await exists(join(root, 'out/contact.png')))

    await run(root, 'status')
    const status = await readFile(join(root, 'status.md'), 'utf8')
    assert.match(status, /out\/final\.mp4/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('check exits non-zero when the plan breaks a rule', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-check-'))
  try {
    const broken = plan()
    broken.hook = { options: ['one'] }
    await writeFile(join(root, 'plan.json'), JSON.stringify(broken))
    await assert.rejects(run(root, 'check'), (error) => {
      assert.match(error.stdout, /hook\.options/)
      return true
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('takes submit without a server address explains what to set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-noserver-'))
  try {
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan()))
    await assert.rejects(exec(process.execPath, [cli, 'takes', 'submit'], { cwd: root, env: { PATH: process.env.PATH, HOME: root } }), (error) => {
      assert.match(error.stderr, /LTX_URL/)
      return true
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

async function fakeProject(plan, settings = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sd-state-'))
  await mkdir(join(root, 'config'), { recursive: true })
  await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
  await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 128, height: 224, fps: 24, video: { width: 128, height: 192, fps: 24 }, ...settings }))
  return root
}

function chainPlan() {
  const shot = (seconds) => [{ seconds, framing: 'wide', action: 'a' }]
  return {
    title: 'chain',
    hook: { options: [{ line: 'A', mechanism: 'loss', question: 'a?' }, { line: 'B', mechanism: 'gap', question: 'b?' }, { line: 'C', mechanism: 'situation', question: 'c?' }], chosen: 0 },
    moments: [
      { id: 'm1', kind: 'take', place: 'p', seconds: 2, shots: shot(2), video_prompt: 'one' },
      { id: 'm2', kind: 'take', place: 'p', seconds: 2, from: { take: 'm1' }, shots: shot(2), video_prompt: 'two' },
      { id: 'm3', kind: 'take', place: 'p', seconds: 2, from: { take: 'm2' }, shots: shot(2), video_prompt: 'three' },
    ],
  }
}

test('a take file always matches the current plan: reverting a change restores that version instead of keeping a stale clip', { skip: !canRender && 'needs ffmpeg', timeout: 120_000 }, async () => {
  const plan = chainPlan()
  plan.moments = [plan.moments[0]]
  plan.moments[0].seconds = 4
  plan.moments[0].shots = [{ seconds: 4, framing: 'wide', action: 'a' }]
  const root = await fakeProject(plan)
  try {
    const duration = async () => Number((await probe(join(root, 'takes/m1.mp4'))).format.duration)
    await run(root, 'takes', 'wait')
    assert.ok(Math.abs(await duration() - 4) < 0.2)
    plan.moments[0].seconds = 2
    plan.moments[0].shots = [{ seconds: 2, framing: 'wide', action: 'a' }]
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
    await run(root, 'takes', 'wait')
    assert.ok(Math.abs(await duration() - 2) < 0.2)
    plan.moments[0].seconds = 4
    plan.moments[0].shots = [{ seconds: 4, framing: 'wide', action: 'a' }]
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
    const reuse = await run(root, 'takes', 'submit')
    assert.match(reuse.stdout, /재사용/)
    assert.ok(Math.abs(await duration() - 4) < 0.2, 'the 4-second version is back in takes/')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('when a take fails, the takes chained from it stop too and wait reports it instead of spinning', { skip: !canRender && 'needs ffmpeg', timeout: 120_000 }, async () => {
  const root = await fakeProject(chainPlan(), { fake: { fail: ['m1'] } })
  try {
    const started = Date.now()
    await assert.rejects(run(root, 'takes', 'wait', '--minutes', '1'), (error) => {
      assert.equal(error.code, 2)
      assert.match(error.stdout, /m1/)
      assert.match(error.stdout, /m3.*m2/)
      return true
    })
    assert.ok(Date.now() - started < 20_000, 'wait stops as soon as nothing can progress')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('takes forget closes a stuck job so the take can be submitted again', async () => {
  const root = await fakeProject(chainPlan())
  try {
    await mkdir(join(root, 'jobs'), { recursive: true })
    const { JobStore } = await import('../lib/jobs.mjs')
    const { buildTake } = await import('../lib/takes.mjs')
    const plan = chainPlan()
    const store = new JobStore(root)
    const stuck = await store.create(buildTake(plan.moments[0], plan, { video: { width: 128, height: 192, fps: 24 } }), 'fake')
    await store.transition(stuck.id, 'submitting')
    const forget = await run(root, 'takes', 'forget', 'm1')
    assert.match(forget.stdout, /m1/)
    assert.equal((await store.get(stuck.id)).state, 'failed')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('status works before plan.json exists and keeps the notes section across refreshes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-status-'))
  try {
    await run(root, 'status')
    const first = await readFile(join(root, 'status.md'), 'utf8')
    assert.match(first, /plan\.json 없음/)
    await writeFile(join(root, 'status.md'), `${first}\n## 메모\n\n- 훅 후보 3번을 골랐다\n`)
    await writeFile(join(root, 'plan.json'), JSON.stringify(chainPlan()))
    await run(root, 'status')
    const second = await readFile(join(root, 'status.md'), 'utf8')
    assert.match(second, /테이크 0\/3/)
    assert.match(second, /## 메모\n\n- 훅 후보 3번을 골랐다/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
