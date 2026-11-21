// 애니매틱(draft)과 완성본(final) 조립. 장면마다 같은 규격의 조각을 만들고 이어 붙인 뒤,
// 내레이션을 깔고 글자 PNG 를 시간대별로 겹친다.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { captionBox, captionEvents } from './captions.mjs'
import { ffmpeg, probe, run } from './media.mjs'
import { materialPath } from './takeState.mjs'

// pathname 은 퍼센트 인코딩이라 공백·한글이 든 설치 경로에서 깨진다.
const JXA = fileURLToPath(new URL('./caption.jxa.js', import.meta.url))

export async function renderVideo({ root, plan, config, mode, narration = [], out }) {
  const { width, height, fps } = config
  const work = join(root, '.work', mode)
  await rm(work, { recursive: true, force: true })
  await mkdir(join(work, 'captions'), { recursive: true })

  const segments = []
  for (const [index, moment] of plan.moments.entries()) {
    const file = join(work, `seg-${String(index).padStart(2, '0')}.mp4`)
    await renderSegment({ root, moment, mode, config, file })
    segments.push(file)
  }
  const list = join(work, 'segments.txt')
  await writeFile(list, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'))
  const base = join(work, 'base.mp4')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', base])

  const events = [...(mode === 'draft' ? storyboardEvents(plan) : []), ...captionEvents(plan, narration)]
  const captions = await renderCaptions(events, join(work, 'captions'), config)
  const total = segmentsSeconds(plan)

  const inputs = ['-i', base]
  const narrationIndex = []
  for (const line of narration) {
    narrationIndex.push(inputs.length / 2)
    inputs.push('-i', join(root, line.file))
  }
  const captionIndex = []
  for (const caption of captions) {
    captionIndex.push(inputs.length / 2)
    inputs.push('-i', caption.file)
  }

  const filters = []
  let video = '0:v'
  captions.forEach((caption, position) => {
    const label = `v${position}`
    filters.push(`[${video}][${captionIndex[position]}:v]overlay=0:0:enable='between(t,${caption.start},${caption.end})'[${label}]`)
    video = label
  })
  const underNarration = narration.length ? config.mix.underNarration : 1
  filters.push(`[0:a]volume=${underNarration}[bed]`)
  const mixInputs = ['[bed]']
  narration.forEach((line, position) => {
    const delay = Math.round(line.start * 1000)
    filters.push(`[${narrationIndex[position]}:a]aresample=48000,aformat=channel_layouts=stereo,adelay=${delay}|${delay}[n${position}]`)
    mixInputs.push(`[n${position}]`)
  })
  filters.push(`${mixInputs.join('')}amix=inputs=${mixInputs.length}:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout]`)

  await mkdir(join(root, 'out'), { recursive: true })
  await ffmpeg([
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', captions.length ? `[${video}]` : '0:v',
    '-map', '[aout]',
    '-t', String(total),
    '-c:v', 'libx264', '-preset', mode === 'final' ? 'medium' : 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart',
    out,
  ])
  return { out, seconds: total, captions: captions.length }
}

export async function contactSheet(input, out, { every = 1.5, columns = 6, tileWidth = 240 } = {}) {
  const { duration } = await probe(input)
  const rows = Math.max(1, Math.ceil(Math.ceil(duration / every) / columns))
  await ffmpeg(['-i', input, '-vf', `fps=1/${every},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=4:color=white`, '-frames:v', '1', out])
  return out
}

// 애니매틱에서 아직 만들지 않은 테이크 자리에 장소와 컷 구성을 적어 둔다(콘티 카드).
function storyboardEvents(plan) {
  const events = []
  let cursor = 0
  for (const moment of plan.moments) {
    const end = Math.round((cursor + Number(moment.seconds)) * 1000) / 1000
    if (moment.kind === 'take') {
      const shots = (moment.shots ?? []).map((shot) => shot.framing).join(' → ')
      events.push({ text: `[${moment.id}] ${moment.place ?? ''}\n${shots}`, role: 'storyboard', start: cursor, end })
    }
    cursor = end
  }
  return events
}

function segmentsSeconds(plan) {
  return Math.round(plan.moments.reduce((sum, moment) => sum + Number(moment.seconds), 0) * 1000) / 1000
}

async function renderSegment({ root, moment, mode, config, file }) {
  const { width: W, height: H, fps } = config
  const seconds = String(moment.seconds)
  // 장면마다 색 형식이 다르면(휴대폰 JPEG 는 full range) 이어 붙인 영상 중간에 형식이 바뀌고, ffmpeg 가 필터를 다시 만들면서
  // 한 장짜리 글자 이미지가 사라진다. 모든 장면을 같은 형식으로 맞춘다.
  const sameFormat = 'scale=out_range=tv:out_color_matrix=bt709,format=yuv420p'
  const fit = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1,fps=${fps},${sameFormat}`
  const encode = ['-t', seconds, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', file]
  const silence = ['-f', 'lavfi', '-t', seconds, '-i', 'anullsrc=r=48000:cl=stereo']

  const clip = join(root, 'takes', `${moment.id}.mp4`)
  if (moment.kind === 'take' && mode === 'final') {
    const info = await probe(clip)
    const audio = info.hasAudio ? ['-map', '0:a', '-af', 'aresample=48000,apad'] : ['-map', '1:a']
    await ffmpeg(['-i', clip, ...silence, '-map', '0:v', '-vf', `${fit},tpad=stop_mode=clone:stop_duration=${seconds}`, ...audio, ...encode])
    return
  }
  if (moment.kind === 'photo') {
    const frames = Math.round(Number(moment.seconds) * fps)
    const zoom = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1,${sameFormat}`
    await ffmpeg(['-i', materialPath(root, moment.file), ...silence, '-map', '0:v', '-map', '1:a', '-vf', zoom, ...encode])
    return
  }
  const fallback = moment.kind === 'card' ? '0x111111' : '0x2a3442'
  const color = /^(0x[0-9a-fA-F]{6}|[a-z]{3,20})$/.test(String(moment.background ?? '')) ? moment.background : fallback
  await ffmpeg(['-f', 'lavfi', '-t', seconds, '-i', `color=c=${color}:s=${W}x${H}:r=${fps}`, ...silence, '-map', '0:v', '-map', '1:a', '-vf', sameFormat, ...encode])
}

async function renderCaptions(events, directory, config) {
  if (events.length === 0) return []
  const items = events.map((event, index) => ({
    ...captionBox(event, config),
    out: join(directory, `cap-${String(index).padStart(2, '0')}.png`),
  }))
  const spec = join(directory, 'spec.json')
  await writeFile(spec, JSON.stringify({ width: config.width, height: config.height, font: config.font, items }))
  await run('osascript', ['-l', 'JavaScript', JXA, spec])
  return events.map((event, index) => ({ file: items[index].out, start: event.start, end: event.end }))
}
