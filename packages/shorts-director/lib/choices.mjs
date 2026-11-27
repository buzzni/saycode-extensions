// 인터뷰용 디자인 비교. 영상을 만들기 전에 사용자가 틀·글자 묶음을 고르게 하는데, 이름만으로는 모습을 떠올리기 어렵다.
// 그래서 후보(틀/묶음)마다 이 영상의 실제 위 제목·첫 실물 그림·첫 말 한 줄을 얹은 한 장을 그려 나란히 보여 준다.
// 후보는 "<틀 id 또는 full>/<look>" 으로 적고, 인터뷰 선택지와 같은 A·B·C 로 부른다.
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { subtitleChunks } from './captions.mjs'
import { frames } from './formats.mjs'
import { LOOKS } from './looks.mjs'
import { ffmpeg } from './media.mjs'
import { renderVideo } from './render.mjs'
import { materialPath } from './takeState.mjs'

const SECONDS = 1.2
const LABELS = 'ABCDEF'

export function parseChoices(args, list) {
  if (args.length < 2 || args.length > LABELS.length) throw new Error(`후보는 두 개 이상 ${LABELS.length}개 이하로 적는다 — 예: choices steps-clean/clean full/vlog`)
  const ids = (list ?? frames()).map((frame) => frame.id)
  return args.map((arg, index) => {
    const [frame, look] = String(arg).split('/')
    if (frame !== 'full' && !ids.includes(frame)) throw new Error(`틀 ${frame} 이 없다 — full 또는 ${ids.join(', ')}`)
    if (!Object.hasOwn(LOOKS, look ?? '')) throw new Error(`look ${look} 이 없다 — ${Object.keys(LOOKS).join(', ')}`)
    return { label: LABELS[index], frame, look }
  })
}

function headlineOf(plan) {
  const hook = plan.moments?.[0]?.caption?.role === 'hook' ? plan.moments[0].caption : undefined
  if (plan.format?.headline?.text) return plan.format.headline
  if (hook) return { text: hook.text, ...(hook.emphasis ? { emphasis: hook.emphasis } : {}) }
  return { text: plan.hook?.options?.[plan.hook.chosen]?.line ?? plan.title ?? '' }
}

/** 첫 실물 사진(없으면 회색 판)을 materials/still.<확장자> 로 쓰는 한 장면짜리 기획. */
export function choicePlan(plan, choice, stillName = `materials/still${extname(firstPhoto(plan) ?? '.png') || '.png'}`) {
  const headline = headlineOf(plan)
  const spoken = plan.narration?.[0]?.text ?? plan.hook?.options?.[plan.hook.chosen]?.line ?? ''
  const subtitle = spoken ? subtitleChunks({ text: spoken, start: 0, end: SECONDS })[0]?.text : undefined
  const moment = {
    id: 'm1',
    kind: 'photo',
    file: stillName,
    seconds: SECONDS,
    shots: [{ seconds: SECONDS, framing: 'photo', action: 'still' }],
    ...(subtitle ? { subtitles: [{ text: subtitle, at: 0, seconds: SECONDS }] } : {}),
  }
  const mini = { version: 1, title: plan.title, look: choice.look, sfx: false, subtitles: false, moments: [moment] }
  if (choice.frame === 'full') {
    moment.caption = { text: headline.text, role: 'hook', ...(headline.emphasis ? { emphasis: headline.emphasis } : {}) }
  } else {
    mini.format = { layout: 'band', frame: choice.frame, headline }
    moment.badge = '1'
  }
  return mini
}

function firstPhoto(plan) {
  return plan.moments?.find((moment) => moment.kind === 'photo')?.file
}

async function writeStill(root, plan, work, stillName, config) {
  const target = join(work, stillName)
  await mkdir(join(work, 'materials'), { recursive: true })
  const photo = firstPhoto(plan)
  if (photo) return copyFile(materialPath(root, photo), target)
  const take = plan.moments?.find((moment) => moment.kind === 'take')
  const clip = take ? join(root, 'takes', `${take.id}.mp4`) : undefined
  if (clip && await access(clip).then(() => true, () => false)) {
    return ffmpeg(['-ss', '1', '-i', clip, '-frames:v', '1', target])
  }
  return ffmpeg(['-f', 'lavfi', '-i', `color=c=0x6b7280:s=${config.width}x${config.height}`, '-frames:v', '1', target])
}

export async function renderChoices({ root, plan, config, choices, outDir }) {
  await mkdir(outDir, { recursive: true })
  const results = []
  for (const choice of choices) {
    const work = await mkdtemp(join(tmpdir(), 'sd-choice-'))
    try {
      const mini = choicePlan(plan, choice)
      await writeStill(root, plan, work, mini.moments[0].file, config)
      const video = join(work, 'choice.mp4')
      await renderVideo({ root: work, plan: mini, config, mode: 'final', out: video, name: 'choice' })
      const png = join(outDir, `${choice.label}.png`)
      await ffmpeg(['-ss', String(SECONDS - 0.2), '-i', video, '-frames:v', '1', png])
      results.push({ ...choice, png })
    } finally {
      await rm(work, { recursive: true, force: true })
    }
  }
  return results
}

export async function choicesSheet(results, out) {
  const inputs = results.flatMap((result) => ['-i', result.png])
  await ffmpeg([...inputs, '-filter_complex', `hstack=inputs=${results.length}`, out])
}

export async function choicesPage(results, { frameNames = new Map(frames().map((frame) => [frame.id, frame.name])) } = {}) {
  const tiles = await Promise.all(results.map(async (result) => {
    const data = (await readFile(result.png)).toString('base64')
    const what = result.frame === 'full' ? '전체 화면' : `띠형 · ${frameNames.get(result.frame) ?? result.frame} (${result.frame})`
    return `<figure><img src="data:image/png;base64,${data}" alt="${result.label}"><figcaption><b>${result.label}</b> ${what} · 글자 ${result.look}</figcaption></figure>`
  }))
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>디자인 후보</title>
<style>body{margin:0;background:var(--saycode-bg,#fff);color:var(--saycode-text,#1b1b1f);font:15px/1.5 var(--saycode-font,-apple-system,system-ui,sans-serif)}
main{padding:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;max-width:1100px;margin:0 auto}
figure{margin:0}img{width:100%;border-radius:10px;display:block;border:1px solid var(--saycode-border,#e3e3e8)}figcaption{margin-top:6px;font-size:14px}</style>
</head><body><main>${tiles.join('')}</main></body></html>`
}

export async function writeChoices({ root, plan, config, args }) {
  const choices = parseChoices(args)
  const outDir = join(root, 'out', 'choices')
  const results = await renderChoices({ root, plan, config, choices, outDir })
  await choicesSheet(results, join(root, 'out', 'choices.png'))
  await writeFile(join(root, 'out', 'choices.html'), await choicesPage(results))
  return results
}
