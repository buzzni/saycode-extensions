// 가짜 백엔드로 ①~⑩ 전체 흐름을 실제 ffmpeg 와 글자 렌더러로 돌린다. Google 호출·한도 소비 없음.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const cli = new URL('../sd.mjs', import.meta.url).pathname
const canRender = await Promise.all([exec('ffmpeg', ['-version']), exec('osascript', ['-e', '1'])]).then(() => true, () => false)

function plan() {
  const shots = (count, seconds) => Array.from({ length: count }, (_, index) => ({ seconds, framing: `f${index}`, action: 'a' }))
  return {
    version: 1,
    title: '테스트',
    language: 'ko',
    aspect: '9:16',
    target_seconds: 12,
    hook: { options: ['A', 'B', 'C'], chosen: 0 },
    subjects: [{ id: 'hero', kind: 'person', look: 'a woman in a beige trench coat' }],
    moments: [
      { id: 'm1', kind: 'take', place: 'subway exit', seconds: 4, subjects: ['hero'], first_frame: { prompt: 'she stands at the exit' }, shots: shots(2, 2), video_prompt: 'she runs into the rain', caption: { text: '우산 없이 나왔다', role: 'hook' } },
      { id: 'm2', kind: 'photo', file: 'materials/photo.png', seconds: 3, shots: shots(1, 3) },
      { id: 'm3', kind: 'take', place: 'bus stop', seconds: 3, subjects: ['hero'], first_frame: { prompt: 'bus stop' }, shots: shots(1, 3), video_prompt: 'the bus arrives' },
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

    const check = await run(root, 'check')
    assert.match(check.stdout, /오류 0/)

    await run(root, 'stills')
    for (const file of ['stills/hero-sheet.png', 'stills/m1.png', 'stills/m3.png']) assert.ok(await exists(join(root, file)), file)

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
    await run(root, 'takes', 'poll')
    for (const id of ['m1', 'm3']) assert.ok(await exists(join(root, `takes/${id}.mp4`)), id)
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

test('takes submit refuses to spend API money without an explicit approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-approve-'))
  try {
    await mkdir(join(root, 'config'), { recursive: true })
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan()))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ video: { api: { enabled: true, capUsd: 3 } } }))
    await writeFile(join(root, '.env'), 'GEMINI_API_KEY=test-key-not-used\n')
    await assert.rejects(run(root, 'takes', 'submit'), (error) => {
      assert.match(error.stdout + error.stderr, /승인|--approve/)
      return true
    })
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
