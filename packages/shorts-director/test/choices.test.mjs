import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import { choicePlan, parseChoices } from '../lib/choices.mjs'

const exec = promisify(execFile)
const cli = new URL('../bin/shorts-director.mjs', import.meta.url).pathname
const canRender = await Promise.all([exec('ffmpeg', ['-version']), exec('osascript', ['-e', '1'])]).then(() => true, () => false)

const plan = {
  version: 1, title: '파스타', aspect: '9:16', target_seconds: 20, look: 'clean',
  hook: { options: [{ line: '물 끓기 전에 소금 넣으면 망해요', mechanism: 'loss', question: 'q' }], chosen: 0 },
  moments: [
    { id: 'm1', kind: 'take', seconds: 3, caption: { text: '소금 언제 넣어요?', role: 'hook', emphasis: '소금' } },
    { id: 'm2', kind: 'photo', file: 'materials/pasta.jpg', seconds: 3 },
  ],
  narration: [{ text: '물 끓기 전에 소금을 넣으면 면이 퍼져요.' }],
}

test('candidates are written frame/look and get the letters the interview uses', () => {
  assert.deepEqual(parseChoices(['steps-clean/clean', 'full/vlog']), [
    { label: 'A', frame: 'steps-clean', look: 'clean' },
    { label: 'B', frame: 'full', look: 'vlog' },
  ])
  assert.throws(() => parseChoices(['nope/clean', 'full/vlog']), /틀/)
  assert.throws(() => parseChoices(['steps-clean/nope', 'full/vlog']), /look/)
  assert.throws(() => parseChoices(['steps-clean/clean']), /두 개/)
})

test('each candidate shows this video: its headline, the first real picture and its first spoken line', () => {
  const band = choicePlan(plan, { frame: 'steps-clean', look: 'review' })
  assert.equal(band.look, 'review')
  assert.deepEqual(band.format, { layout: 'band', frame: 'steps-clean', headline: { text: '소금 언제 넣어요?', emphasis: '소금' } })
  assert.equal(band.moments[0].file, 'materials/still.jpg')
  assert.equal(band.moments[0].badge, undefined, 'no number unless the plan numbers its scenes — a story frame should not show "1"')
  const numbered = choicePlan({ ...plan, moments: plan.moments.map((moment, index) => ({ ...moment, badge: String(index + 1) })) }, { frame: 'steps-clean', look: 'clean' })
  assert.equal(numbered.moments[0].badge, '1')
  assert.equal(band.moments[0].subtitles[0].text, '물 끓기 전에 소금을 넣으면')
  const full = choicePlan(plan, { frame: 'full', look: 'vlog' })
  assert.equal(full.format, undefined)
  assert.equal(full.moments[0].caption.role, 'hook')
  assert.equal(full.sfx, false)
})

test('choices renders one picture per candidate, a side-by-side sheet and a labelled page', { skip: !canRender && 'needs ffmpeg and macOS osascript', timeout: 240_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-choices-'))
  try {
    await mkdir(join(root, 'materials'), { recursive: true })
    await mkdir(join(root, 'config'), { recursive: true })
    await exec('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=orange:s=640x960', '-frames:v', '1', join(root, 'materials/pasta.jpg')])
    await writeFile(join(root, 'plan.json'), JSON.stringify(plan))
    await writeFile(join(root, 'config/settings.json'), JSON.stringify({ fake: true, width: 270, height: 480, fps: 24 }))
    const { stdout } = await exec(process.execPath, [cli, 'choices', 'steps-clean/clean', 'full/vlog'], { cwd: root })
    assert.match(stdout, /A · steps-clean/)
    for (const file of ['out/choices/A.png', 'out/choices/B.png', 'out/choices.png', 'out/choices.html']) {
      await access(join(root, file))
    }
    const html = await readFile(join(root, 'out/choices.html'), 'utf8')
    assert.match(html, /data:image\/png;base64,/)
    assert.match(html, /꽉 찬 화면/, 'plain names, not only ids')
    // 그림만 보이는 대화에서도 A·B·C 를 알아보게 이름표 띠를 아래에 붙인다 — 그래서 한 장이 화면보다 길다.
    const { stdout: size } = await exec('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', join(root, 'out/choices/A.png')])
    const [width, height] = size.trim().split(',').map(Number)
    assert.ok(height > width * 16 / 9, `${width}x${height}`)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
