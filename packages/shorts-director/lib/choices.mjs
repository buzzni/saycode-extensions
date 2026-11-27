// 인터뷰용 디자인 비교. 영상을 만들기 전에 사용자가 틀·글자 묶음을 고르게 하는데, 이름만으로는 모습을 떠올리기 어렵다.
// 그래서 후보(틀/묶음)마다 이 영상의 실제 위 제목·첫 실물 그림·첫 말 한 줄을 얹은 한 장을 그려 나란히 보여 준다.
// 후보는 "<틀 id 또는 full>/<look>" 으로 적고, 인터뷰 선택지와 같은 A·B·C 로 부른다.
import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'

import { subtitleChunks } from './captions.mjs'
import { frameById, frames } from './formats.mjs'
import { LOOKS } from './looks.mjs'
import { ffmpeg } from './media.mjs'
import { renderVideo, renderSvg } from './render.mjs'
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
    // 번호는 기획이 장면에 번호를 달았을 때만 — 썰·대화형 틀에 "1" 이 보이면 다른 영상처럼 보인다.
    const badge = plan.moments?.find((candidate) => candidate.badge)?.badge
    if (badge) moment.badge = badge
  }
  return mini
}

/** 사람이 읽는 이름: 틀 이름과 어디에 맞는지, 글자 묶음의 결. */
export function choiceName(choice, list) {
  const look = LOOKS[choice.look]?.suits?.split(' — ')[0] ?? choice.look
  if (choice.frame === 'full') return { title: '꽉 찬 화면', detail: `영상이 화면을 꽉 채운다 · 글자 ${look}` }
  const frame = frameById(choice.frame, list)
  return { title: frame?.name ?? choice.frame, detail: `${frame?.suits ?? ''} · 글자 ${look}` }
}

const escapeXml = (text) => String(text).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

// 한 줄 약 14자로 끊는다(띄어쓰기에서).
function wrap(text, width = 14) {
  const lines = []
  let line = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) {
      lines.push(line)
      line = word
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  return lines.slice(0, 4)
}

function placeholderSvg(text, { width, height }) {
  const size = Math.round(width * 0.06)
  const lines = wrap(text)
  const top = Math.round(height / 2 - (lines.length * size * 1.4) / 2)
  const rows = lines.map((line, index) => `<text x="${width / 2}" y="${top + (index + 1) * size * 1.4}" text-anchor="middle" font-family="Apple SD Gothic Neo" font-weight="600" font-size="${size}" fill="#E5E7EB">${escapeXml(line)}</text>`)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#4B5563"/><text x="${width / 2}" y="${Math.round(top - size)}" text-anchor="middle" font-family="Apple SD Gothic Neo" font-size="${Math.round(size * 0.7)}" fill="#9CA3AF">첫 장면 (영상 생성 전)</text>${rows.join('')}</svg>`
}

function labelSvg(label, name, width) {
  const height = Math.round(width * 0.2)
  const big = Math.round(height * 0.42)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#111827"/>`
    + `<text x="${Math.round(width * 0.05)}" y="${Math.round(height * 0.6)}" font-family="Apple SD Gothic Neo" font-weight="800" font-size="${big}" fill="#FFD23F">${label}</text>`
    + `<text x="${Math.round(width * 0.16)}" y="${Math.round(height * 0.52)}" font-family="Apple SD Gothic Neo" font-weight="700" font-size="${Math.round(big * 0.7)}" fill="#FFFFFF">${escapeXml(name.title)}</text>`
    + `<text x="${Math.round(width * 0.16)}" y="${Math.round(height * 0.84)}" font-family="Apple SD Gothic Neo" font-size="${Math.round(big * 0.45)}" fill="#9CA3AF">${escapeXml(name.detail)}</text></svg>`
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
  // 실물 그림이 없으면 회색 판에 첫 장면 설명을 적는다 — 세 후보가 모두 빈 회색이면 비교가 안 된다.
  const scene = plan.hook?.options?.[plan.hook.chosen]?.frame ?? plan.moments?.[0]?.place ?? plan.moments?.[0]?.caption?.text ?? ''
  const svg = join(work, 'placeholder.svg')
  await writeFile(svg, placeholderSvg(scene, config))
  await renderSvg([{ svg, out: target, width: config.width, height: config.height }], work)
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
      const frame = join(work, 'frame.png')
      await ffmpeg(['-ss', String(SECONDS - 0.2), '-i', video, '-frames:v', '1', frame])
      // 그림만 보이는 대화에서도 어느 것이 A 인지 알도록 아래에 이름표 띠를 붙인다.
      const name = choiceName(choice)
      const labelFile = join(work, 'label.svg')
      const labelPng = join(work, 'label.png')
      await writeFile(labelFile, labelSvg(choice.label, name, config.width))
      await renderSvg([{ svg: labelFile, out: labelPng, width: config.width, height: Math.round(config.width * 0.2) }], work)
      const png = join(outDir, `${choice.label}.png`)
      await ffmpeg(['-i', frame, '-i', labelPng, '-filter_complex', 'vstack=inputs=2', png])
      results.push({ ...choice, ...name, png })
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

export async function choicesPage(results) {
  const tiles = await Promise.all(results.map(async (result) => {
    const data = (await readFile(result.png)).toString('base64')
    return `<figure><img src="data:image/png;base64,${data}" alt="${result.label} ${escapeXml(result.title)}"><figcaption><b>${result.label} ${escapeXml(result.title)}</b><br>${escapeXml(result.detail)}<br><small>${result.frame}/${result.look}</small></figcaption></figure>`
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
