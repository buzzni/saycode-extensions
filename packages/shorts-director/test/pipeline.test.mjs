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
    assert.ok(narration.lines[0].tempo > 1, 'slow speech is sped up')
    assert.ok(narration.lines[1].start - narration.lines[0].end <= 0.11, 'lines follow each other with a short breath')

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

    assert.match((await run(root, 'render')).stdout, /화면 문구: 얼굴·주인공 가림 없음|가림|가장자리/, 'render reports where the on-screen text sits')
    const placement = JSON.parse(await readFile(join(root, 'out/text-check.json'), 'utf8'))
    assert.ok(placement.length >= 1 && placement.every((entry) => entry.box.w > 0 && entry.box.h > 0), 'every on-screen caption has its drawn box measured')

    const sheet = await run(root, 'sheet')
    assert.ok(await exists(join(root, 'out/contact.png')))
    assert.match(sheet.stdout, /칸마다 시각/, 'every tile is labelled with its time')
    assert.match(sheet.stdout, /1행: 0초 · 1\.5초 · 3초/)

    await run(root, 'status')
    const status = await readFile(join(root, 'status.md'), 'utf8')
    assert.match(status, /out\/final\.mp4/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a variant changes only words: no new take, its own narration, final, viewer script, contact sheet, post copy and cover', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 300_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-variant-'))
  try {
    await mkdir(join(root, 'materials'), { recursive: true })
    await mkdir(join(root, 'config'), { recursive: true })
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=640x960', '-frames:v', '1', join(root, 'materials/photo.png')])
    const withVariant = plan()
    withVariant.post = { shorts: { title: '우산 없이 나온 날', text: '비 오는 퇴근길.', tags: ['퇴근길', '우산'] } }
    withVariant.cover = { at: 1, text: '우산 없이 나온 날', emphasis: '우산' }
    withVariant.variants = [{
      id: 'b',
      hypothesis: '손실형 첫 문장이 질문형보다 덜 넘긴다',
      hook: 1,
      moments: { m1: { caption: { text: '우산 없으면 손해', role: 'hook' } } },
      narration: { 0: '우산 없으면 매일 손해예요.' },
      post: { shorts: { title: '우산 없으면 손해', text: '비 오는 퇴근길.', tags: ['우산'] } },
    }]
    await writeFile(join(root, 'plan.json'), JSON.stringify(withVariant, null, 2))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))

    assert.match((await run(root, 'check')).stdout, /오류 0/)
    await run(root, 'voice')
    const variantVoice = await run(root, 'voice', '--variant', 'b')
    assert.match(variantVoice.stdout, /↺ 01/, 'an unchanged line reuses the base recording')
    const narration = JSON.parse(await readFile(join(root, 'audio/variants/b/narration.json'), 'utf8'))
    assert.equal(narration.lines[0].text, '우산 없으면 매일 손해예요.')
    assert.match(narration.lines[0].file, /audio\/variants\/b\//)
    assert.match(narration.lines[1].file, /audio\/narration\//)

    await run(root, 'takes', 'submit')
    await run(root, 'takes', 'wait')
    const jobs = (await run(root, 'takes', 'status')).stdout.trim().split('\n')
    await run(root, 'render')
    const rendered = await run(root, 'render', '--variant', 'b')
    assert.match(rendered.stdout, /out\/final-b\.mp4/)
    assert.match(rendered.stdout, /손실형 첫 문장이 질문형보다 덜 넘긴다/, 'the variant restates what it tests')
    assert.deepEqual((await run(root, 'takes', 'status')).stdout.trim().split('\n'), jobs, 'no take was submitted for the variant')
    const final = await probe(join(root, 'out/final-b.mp4'))
    assert.ok(Math.abs(Number(final.format.duration) - 12) < 0.3, `variant duration ${final.format.duration}`)
    assert.ok(await exists(join(root, 'out/text-check-b.json')))
    assert.match(await readFile(join(root, 'out/viewer.md'), 'utf8'), /우산 없이 나왔다/)
    const viewer = await readFile(join(root, 'out/viewer-b.md'), 'utf8')
    assert.match(viewer, /우산 없으면 손해/)
    assert.match(viewer, /out\/contact-b\.png/)

    await run(root, 'sheet', '--variant', 'b')
    assert.ok(await exists(join(root, 'out/contact-b.png')))

    // 가짜 영상(색 막대)에는 얼굴이 없다 — 후보가 있으면 시각이 적힌 그림을, 없으면 직접 고르라는 안내를 낸다.
    const candidates = await run(root, 'cover').then((result) => result.stdout, (error) => error.stderr)
    assert.match(candidates, /cover-candidates\.png|직접 cover\.at 을 고른다/)

    const post = await run(root, 'post')
    assert.match(post.stdout, /out\/post\.md/)
    assert.match(post.stdout, /표지 문구: 얼굴·주인공 가림 없음/, 'the cover text is checked against faces like on-screen captions')
    assert.match(await readFile(join(root, 'out/post.md'), 'utf8'), /제목: 우산 없이 나온 날[\s\S]*#퇴근길 #우산/)
    const cover = await probe(join(root, 'out/cover.jpg'))
    assert.deepEqual([cover.streams[0].width, cover.streams[0].height], [270, 480])
    assert.ok(await differingShare(join(root, 'out/cover.jpg'), join(root, '.work/cover/frame.png')) > 0.02, 'the cover text is drawn over the frame')
    await run(root, 'post', '--variant', 'b')
    assert.match(await readFile(join(root, 'out/post-b.md'), 'utf8'), /제목: 우산 없으면 손해[\s\S]*out\/cover-b\.jpg/)
    assert.ok(await exists(join(root, 'out/cover-b.jpg')))

    await run(root, 'status')
    assert.match(await readFile(join(root, 'status.md'), 'utf8'), /변형 b[\s\S]*out\/final-b\.mp4/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('voice keeps a recording whose line did not change, and --fresh records again', { skip: !canRender && 'needs ffmpeg', timeout: 120_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-voice-'))
  try {
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))
    const script = plan()
    await writeFile(join(root, 'plan.json'), JSON.stringify(script, null, 2))
    assert.match((await run(root, 'voice')).stdout, /✓ 00[\s\S]*✓ 01/)
    const first = JSON.parse(await readFile(join(root, 'audio/narration.json'), 'utf8')).lines

    const again = await run(root, 'voice')
    assert.match(again.stdout, /↺ 00 .*이전 녹음[\s\S]*↺ 01 /, 'nothing changed, nothing is recorded again')
    assert.deepEqual(JSON.parse(await readFile(join(root, 'audio/narration.json'), 'utf8')).lines.map((line) => line.file), first.map((line) => line.file))

    script.narration[1].text = '오늘이 바로 그날이에요.'
    await writeFile(join(root, 'plan.json'), JSON.stringify(script, null, 2))
    const edited = await run(root, 'voice')
    assert.match(edited.stdout, /↺ 00 [\s\S]*✓ 01 /, 'only the edited line is recorded')
    const lines = JSON.parse(await readFile(join(root, 'audio/narration.json'), 'utf8')).lines
    assert.equal(lines[0].file, first[0].file)
    assert.notEqual(lines[1].file, first[1].file, 'a new recording never overwrites one that is still in use')
    assert.ok(await exists(join(root, lines[1].file)))

    assert.match((await run(root, 'voice', '--fresh', '0')).stdout, /✓ 00 [\s\S]*↺ 01 /, '--fresh <line> records that line again')
    assert.match((await run(root, 'voice', '--fresh')).stdout, /✓ 00 [\s\S]*✓ 01 /, '--fresh records every line again')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// 두 그림에서 눈에 띄게(32 단계 넘게) 다른 화소의 비율.
async function differingShare(left, right) {
  const gray = async (file) => (await exec('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 })).stdout
  const [a, b] = await Promise.all([gray(left), gray(right)])
  let differ = 0
  for (let index = 0; index < a.length; index += 1) if (Math.abs(a[index] - b[index]) > 32) differ += 1
  return differ / a.length
}

// 카드 배경(어두운 단색) 위 가장 밝은 화소 — 글자가 있으면 흰색에 가깝다.
async function brightestAt(file, seconds) {
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-ss', String(seconds), '-i', file, '-frames:v', '1', '-vf', 'format=gray', '-f', 'rawvideo', '-'], { encoding: 'buffer', maxBuffer: 10 * 1024 * 1024 })
  return stdout.reduce((max, value) => Math.max(max, value), 0)
}

test('captions after a JPEG photo still show: a phone photo does not drop the later captions', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-jpeg-'))
  try {
    await mkdir(join(root, 'materials'), { recursive: true })
    await mkdir(join(root, 'config'), { recursive: true })
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=640x960', '-frames:v', '1', join(root, 'materials/photo.jpg')])
    const withJpeg = plan()
    withJpeg.moments[1].file = 'materials/photo.jpg'
    await writeFile(join(root, 'plan.json'), JSON.stringify(withJpeg, null, 2))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))

    await run(root, 'voice')
    await run(root, 'takes', 'submit')
    await run(root, 'takes', 'wait')
    await run(root, 'render')
    assert.ok(await brightestAt(join(root, 'out/final.mp4'), 11) > 200, 'the card caption after the photo is drawn')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

// 구간 평균 음량(dBFS).
async function loudnessAt(file, from, seconds) {
  const { stderr } = await exec('ffmpeg', ['-hide_banner', '-ss', String(from), '-t', String(seconds), '-i', file, '-af', 'volumedetect', '-f', 'null', '-'])
  return Number(stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/)?.[1] ?? -Infinity)
}

test('the sound bed: scene sound dips only under narration, music fills the gaps and the ending fades out', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-mix-'))
  try {
    await mkdir(join(root, 'materials'), { recursive: true })
    await mkdir(join(root, 'config'), { recursive: true })
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=640x960', '-frames:v', '1', join(root, 'materials/photo.png')])
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=5', join(root, 'materials/music.wav')])
    const withMusic = { ...plan(), music: { file: 'materials/music.wav' } }
    await writeFile(join(root, 'plan.json'), JSON.stringify(withMusic, null, 2))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))

    await run(root, 'voice')
    await run(root, 'takes', 'submit')
    await run(root, 'takes', 'wait')
    await run(root, 'render')
    const final = join(root, 'out/final.mp4')
    const sceneAlone = await loudnessAt(final, 7.5, 2) // m3 테이크, 내레이션 없음
    const underVoice = await loudnessAt(final, 0.4, 1) // m1 테이크 위 내레이션
    assert.ok(sceneAlone > underVoice - 3, `scene sound without narration keeps its level (${sceneAlone} vs ${underVoice} dB)`)
    assert.ok(await loudnessAt(final, 4.5, 2) > -45, 'music plays under the silent photo scene')
    assert.ok(await loudnessAt(final, 11.85, 0.15) < (await loudnessAt(final, 10.5, 0.5)) - 6, 'the last moment fades out')
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

test('a chained take changes framing at each planned shot (punch-in), so a continuous shot still cuts', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 120_000 }, async () => {
  const chained = chainPlan()
  chained.moments[1].shots = [{ seconds: 1, framing: 'wide', action: 'a' }, { seconds: 1, framing: 'close', action: 'b' }]
  const root = await fakeProject(chained)
  try {
    await run(root, 'takes', 'submit')
    await run(root, 'takes', 'wait')
    const { stdout } = await run(root, 'render')
    // 시험 패턴(색 막대)은 확대해도 장면 점수가 낮아 기준을 낮춰 잰다.
    const { stderr } = await exec('ffmpeg', ['-hide_banner', '-i', join(root, 'out/final.mp4'), '-filter:v', "select='gt(scene,0.15)',showinfo", '-f', 'null', '-'])
    const cuts = [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Number(match[1]))
    for (const at of [2, 3, 4]) assert.ok(cuts.some((cut) => Math.abs(cut - at) < 0.1), `the framing changes at ${at}s along the chain: ${cuts}`)
    assert.match(stdout, /컷 3개\(기획 3개\)/, 'the punch-ins the renderer made count as cuts in the rhythm report')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the rhythm report counts every switch to a new take as a cut, even when the frames look alike', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 120_000 }, async () => {
  const separate = chainPlan()
  for (const moment of separate.moments) delete moment.from
  const root = await fakeProject(separate)
  try {
    await run(root, 'takes', 'submit')
    await run(root, 'takes', 'wait')
    const { stdout } = await run(root, 'render')
    assert.match(stdout, /컷 2개\(기획 2개\)/, stdout)
    assert.doesNotMatch(stdout, /한 화면으로/, 'no false "one long shot" warning')
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
