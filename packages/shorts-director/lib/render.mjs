// 애니매틱(draft)과 완성본(final) 조립. 장면마다 같은 규격의 조각을 만들고 이어 붙인 뒤,
// 내레이션을 깔고 글자 PNG 를 시간대별로 겹친다.
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FONTS, MUSIC, ensureAsset } from './assets.mjs'
import { captionBox, captionEvents } from './captions.mjs'
import { designFor, lookFonts } from './looks.mjs'
import { MIRROR_PAD, croppedHeads, cutSides, mirroredFaces, textProblems } from './textcheck.mjs'
import { userConfigDir } from './config.mjs'
import { ffmpeg, probe, run } from './media.mjs'
import { SFX_KINDS, sfxEvents } from './sfx.mjs'
import { materialPath } from './takeState.mjs'
import { pickCoverMoments } from './coverPick.mjs'
import { choosePlacement } from './placement.mjs'
import { COVER_GRID, COVER_Y } from './post.mjs'
import { bandLayout, bandRange } from './formats.mjs'

// pathname 은 퍼센트 인코딩이라 공백·한글이 든 설치 경로에서 깨진다.
const JXA = fileURLToPath(new URL('./caption.jxa.js', import.meta.url))
const VISION = fileURLToPath(new URL('./vision.jxa.js', import.meta.url))
const SVG = fileURLToPath(new URL('./svg.jxa.js', import.meta.url))

export async function renderVideo({ root, plan, config, mode, narration = [], out, name = mode, checkFile = 'text-check.json' }) {
  const { width, height, fps } = config
  const work = join(root, '.work', name)
  await rm(work, { recursive: true, force: true })
  await mkdir(join(work, 'captions'), { recursive: true })

  const framing = mode === 'final' ? punchIns(plan) : { zooms: new Map(), edits: [] }
  // 띠형이면 장면을 틀의 창 크기로 만들고, 이어 붙인 뒤 틀 위에 얹는다.
  const band = bandLayout(plan, config)
  const segmentConfig = band ? { ...config, width: band.content.w, height: band.content.h } : config
  const segments = []
  for (const [index, moment] of plan.moments.entries()) {
    const file = join(work, `seg-${String(index).padStart(2, '0')}.mp4`)
    await renderSegment({ root, moment, mode, config: segmentConfig, file, zooms: framing.zooms.get(moment.id) })
    segments.push(file)
  }
  const list = join(work, 'segments.txt')
  await writeFile(list, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'))
  const base = join(work, 'base.mp4')
  const joined = band ? join(work, 'content.mp4') : base
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', joined])
  if (band) await composeBand({ band, content: joined, out: base, work, config, seconds: segmentsSeconds(plan) })

  const events = [...(mode === 'draft' ? storyboardEvents(plan) : []), ...captionEvents(plan, narration, band?.frame)]
  let captions = await renderCaptions(events, join(work, 'captions'), config, plan.look)
  let seen = new Map()
  let moved = []
  if (mode === 'final') {
    seen = await lookOnScreen({ base, work, captions, config })
    moved = autoPlace({ events, captions, seen, config, look: plan.look, range: band ? bandRange(band.frame) : POSITION_RANGE })
    if (moved.length) captions = await renderCaptions(events, join(work, 'captions'), config, plan.look)
  }
  const total = segmentsSeconds(plan)

  const inputs = []
  const addInput = (...args) => {
    inputs.push(...args)
    return inputs.filter((arg) => arg === '-i').length - 1
  }
  addInput('-i', base)
  const narrationIndex = narration.map((line) => addInput('-i', join(root, line.file)))
  const music = await musicSource(root, plan.music)
  const musicIndex = music ? addInput('-stream_loop', '-1', '-ss', String(music.start), '-i', music.path) : undefined
  const sounds = sfxEvents(plan).filter((sound) => sound.at < total)
  const sfxIndex = sounds.map((sound) => addInput('-f', 'lavfi', '-i', SFX_KINDS[sound.kind]))
  const captionIndex = captions.map((caption) => addInput('-framerate', String(fps), '-i', caption.pattern))

  const filters = []
  let video = '0:v'
  captions.forEach((caption, position) => {
    const label = `v${position}`
    // 등장 동작 프레임 뒤로 마지막 프레임을 붙들고, 글자가 뜰 시각으로 옮겨 겹친다.
    filters.push(`[${captionIndex[position]}:v]tpad=stop_mode=clone:stop_duration=${round(caption.end - caption.start)},setpts=PTS+${caption.start}/TB[c${position}]`)
    filters.push(`[${video}][c${position}]overlay=0:0:eof_action=pass:enable='between(t,${caption.start},${caption.end})'[${label}]`)
    video = label
  })
  filters.push(...audioFilters({ narration, narrationIndex, musicIndex, music: { ...plan.music, ...music }, sounds, sfxIndex, total, mix: config.mix }))

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
  const placement = mode === 'final' ? await checkPlacement({ root, captions, seen, config, checkFile }) : []
  return { out, seconds: total, captions: captions.length, sounds: sounds.length, edits: framing.edits, placement, moved }
}

// 표지: 글자를 얹기 전의 조립 화면(base)에서 cover.at 시각의 한 장을 뽑아, 훅 모양의 문구를 얹는다. 등장 동작 없이 한 장만 그린다.
// 프로필 격자가 가운데 3:4 만 보여 주므로 문구의 기본 자리는 위쪽 제목 자리(12%)가 아니라 그 안쪽이다.
export async function renderCover({ root, plan, config, base, out }) {
  const work = join(root, '.work', 'cover')
  await rm(work, { recursive: true, force: true })
  await mkdir(join(work, 'captions'), { recursive: true })
  const frame = join(work, 'frame.png')
  await ffmpeg(['-ss', String(plan.cover.at), '-i', base, '-frames:v', '1', frame])
  const { text, emphasis, label, look, position } = plan.cover
  const event = {
    text, role: 'hook', start: 0, end: 1,
    ...(emphasis ? { emphasis } : {}),
    ...(label ? { label } : {}),
    look: { ...look, entrance: 'none' },
    position: { ...position, y: position?.y ?? COVER_Y },
  }
  // 화면 문구와 같은 가림 검사를 받는다 — 표지는 한 장이라 그 화면만 본다. 자리를 정하지 않았으면(position.y 없음) 가릴 때
  // 프로필 격자(가운데 3:4) 안에서 가리지 않는 높이로 옮긴다.
  const [found] = await findOnScreen([frame], [1], config)
  let [caption] = await renderCaptions([event], join(work, 'captions'), config, plan.look)
  let moved
  if (position?.y === undefined && caption.bounds) {
    const box = fromTop(caption.bounds, config.width, config.height)
    const choice = choosePlacement({ box, ...found, range: COVER_GRID })
    if (choice.moved) {
      event.position = { ...position, y: Math.round((choice.box.y + choice.box.h / 2) * 1000) / 1000 }
      if (choice.scale !== 1) event.look = { ...event.look, size: Math.round((designFor(plan.look, 'hook', event.look)?.size ?? 1) * choice.scale * 100) / 100 }
      moved = { from: Math.round((box.y + box.h / 2) * 100) / 100, to: event.position.y, scale: choice.scale }
      ;[caption] = await renderCaptions([event], join(work, 'captions'), config, plan.look)
    }
  }
  await mkdir(join(root, 'out'), { recursive: true })
  await ffmpeg(['-i', frame, '-i', caption.pattern.replace('%02d', '00'), '-filter_complex', '[0:v][1:v]overlay=0:0', '-frames:v', '1', '-q:v', '2', out])
  const problems = caption.bounds ? textProblems({ box: fromTop(caption.bounds, config.width, config.height), ...found }) : []
  return { out, problems, moved }
}

// 표지 후보: 글자 없는 조립 화면을 0.5초마다 보고 얼굴(없으면 주인공 사물)이 크고 선명한 순간 count 개를 골라, 시각을 적은 한 장
// (out/cover-candidates.png)으로 보인다. 컷 앞뒤는 섞인 화면이라 뺀다(coverPick.mjs).
const COVER_SAMPLE_EVERY = 0.5

export async function coverCandidates({ root, plan, config, base, out, count = 3 }) {
  const work = join(root, '.work', 'cover-pick')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  await mkdir(join(work, 'labels'), { recursive: true })
  // 찾기는 작은 그림으로 한다(위치는 화면 비율이라 같다). 후보 그림은 원래 크기에서 다시 뽑는다.
  await ffmpeg(['-i', base, '-vf', `fps=${1 / COVER_SAMPLE_EVERY},scale=360:-2`, join(work, 'f-%03d.png')])
  const { stdout } = await run('ffmpeg', ['-hide_banner', '-v', 'error', '-i', base, '-vf', `fps=${1 / COVER_SAMPLE_EVERY},blurdetect,metadata=mode=print:file=-`, '-f', 'null', '-'])
  const blurs = [...stdout.matchAll(/lavfi\.blur=([\d.]+)/g)].map((match) => Number(match[1]))
  const stills = blurs.map((_, index) => join(work, `f-${String(index + 1).padStart(3, '0')}.png`))
  const found = await findOnScreen(stills, stills.map(() => 1), config)
  const samples = found.map((seen, index) => ({ at: round(index * COVER_SAMPLE_EVERY), faces: seen.detectedFaces, subjects: seen.subjects, blur: blurs[index] }))
  const picks = pickCoverMoments(samples, { count, cuts: punchIns(plan).edits })
  if (picks.length === 0) return picks
  const labels = await renderCaptions(picks.map((pick) => ({
    text: `${pick.at}초`, role: 'info', start: 0, end: 1, position: { y: 0.05, x: 'left' }, look: { entrance: 'none', size: 1.5 },
  })), join(work, 'labels'), config, undefined)
  const frames = []
  for (const pick of picks) {
    frames.push(join(work, `pick-${pick.at}.png`))
    await ffmpeg(['-ss', String(pick.at), '-i', base, '-frames:v', '1', frames.at(-1)])
  }
  const inputs = picks.flatMap((_, index) => ['-i', frames[index], '-i', labels[index].pattern.replace('%02d', '00')])
  const tiles = picks.map((_, index) => `[${index * 2}:v][${index * 2 + 1}:v]overlay=0:0,scale=360:-2,pad=iw+8:ih:4:0:white[t${index}]`)
  await mkdir(join(root, 'out'), { recursive: true })
  const stack = picks.length > 1 ? `${picks.map((_, index) => `[t${index}]`).join('')}hstack=inputs=${picks.length}` : '[t0]null'
  await ffmpeg([...inputs, '-filter_complex', `${tiles.join(';')};${stack}`, '-frames:v', '1', out])
  return picks
}

// 접촉 시트의 칸 시각: 0초부터 every 초 간격. 칸마다 그 시각을 작은 칩으로 적는다 — 시각 없이 칸을 세면 한 칸씩 밀려 1.5초
// 어긋난 판정이 나왔다(완성본 점검 실측). config 가 없으면(글자 렌더러 없이) 시각을 적지 않는다.
export function sheetTimes(duration, every = 1.5) {
  return Array.from({ length: Math.max(1, Math.ceil(duration / every)) }, (_, index) => round(index * every))
}

export async function contactSheet(input, out, { every = 1.5, columns = 6, tileWidth = 240, config, root } = {}) {
  const { duration } = await probe(input)
  const times = sheetTimes(duration, every)
  const rows = Math.max(1, Math.ceil(times.length / columns))
  const tile = `fps=1/${every},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=4:color=white`
  if (!config) {
    await ffmpeg(['-i', input, '-vf', tile, '-frames:v', '1', out])
    return { out, times, columns }
  }
  const work = join(root, '.work', 'sheet')
  await rm(work, { recursive: true, force: true })
  await mkdir(work, { recursive: true })
  const events = times.map((at) => ({
    text: `${at}초`, role: 'info', start: Math.max(0, at - every / 2), end: at + every / 2,
    position: { y: 0.05, x: 'left' }, look: { entrance: 'none', size: 1.5 },
  }))
  const labels = await renderCaptions(events, work, config, undefined)
  const filters = []
  let video = '0:v'
  labels.forEach((label, index) => {
    filters.push(`[${video}][${index + 1}:v]overlay=0:0:enable='between(t,${round(label.start)},${round(label.end - 0.001)})'[l${index}]`)
    video = `l${index}`
  })
  filters.push(`[${video}]${tile}[sheet]`)
  await ffmpeg(['-i', input, ...labels.flatMap((label) => ['-i', label.pattern.replace('%02d', '00')]), '-filter_complex', filters.join(';'), '-map', '[sheet]', '-frames:v', '1', out])
  return { out, times, columns }
}

// 배경음: 목록의 CC0 곡(track)은 이 PC 에 받아 두고 완성본 음량(-14 LUFS)에 맞춘다. materials/ 의 파일은 사용자가 정한 크기 그대로.
const MUSIC_TARGET_LUFS = -14

async function musicSource(root, music) {
  if (music?.track !== undefined) {
    const track = MUSIC[music.track]
    if (!track) throw new Error(`배경음 목록에 없는 곡이다: ${music.track} — shorts-director music 으로 고른다`)
    const path = await ensureAsset(track, join(userConfigDir(), 'music'))
    return { path, start: track.start, gain: 10 ** ((MUSIC_TARGET_LUFS - track.lufs) / 20) }
  }
  if (music?.file) return { path: materialPath(root, music.file), start: 0, gain: 1 }
  return undefined
}

// 소리 바닥: 장면 소리와 배경음은 말할 때만 내려가고(덕킹) 말이 없으면 원래 크기로 들린다. 끝은 페이드아웃한다.
// 전체를 한 번에 줄이면 말 사이가 빈 소리가 된다 — 숏폼에서 가장 크게 체감되는 차이였다.
function audioFilters({ narration, narrationIndex, musicIndex, music, sounds, sfxIndex, total, mix }) {
  const stereo = 'aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo'
  const filters = [`[0:a]${stereo}[scene]`]
  const under = ['[scene]']
  if (musicIndex !== undefined) {
    const volume = Number(music.volume ?? mix.music) * music.gain
    filters.push(`[${musicIndex}:a]${stereo},atrim=0:${total},volume=${volume},afade=t=in:d=0.3,afade=t=out:st=${Math.max(0, total - mix.fadeOut)}:d=${mix.fadeOut}[music]`)
    under.push('[music]')
  }
  filters.push(under.length > 1 ? `${under.join('')}amix=inputs=${under.length}:duration=first:normalize=0[bed]` : '[scene]anull[bed]')
  let front = '[bed]'
  if (narration.length) {
    narration.forEach((line, position) => {
      const delay = Math.round(line.start * 1000)
      filters.push(`[${narrationIndex[position]}:a]${stereo},adelay=${delay}|${delay}[n${position}]`)
    })
    const voices = narration.map((_, position) => `[n${position}]`).join('')
    filters.push(`${voices}amix=inputs=${narration.length}:duration=longest:normalize=0,apad,asplit=2[voice][key]`)
    filters.push(`[bed][key]sidechaincompress=threshold=${mix.duck.threshold}:ratio=${mix.duck.ratio}:attack=${mix.duck.attack}:release=${mix.duck.release}[ducked]`)
    filters.push('[ducked][voice]amix=inputs=2:duration=first:normalize=0[front]')
    front = '[front]'
  }
  if (sounds.length) {
    // 효과음은 덕킹하지 않는다 — 말과 같은 층에서 말보다 조금 작게.
    sounds.forEach((sound, position) => {
      const delay = Math.round(sound.at * 1000)
      filters.push(`[${sfxIndex[position]}:a]${stereo},volume=${mix.sfx},adelay=${delay}|${delay}[s${position}]`)
    })
    filters.push(`${front}${sounds.map((_, position) => `[s${position}]`).join('')}amix=inputs=${sounds.length + 1}:duration=first:normalize=0[withsfx]`)
    front = '[withsfx]'
  }
  filters.push(`${front}loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000,alimiter=limit=0.89,afade=t=out:st=${Math.max(0, total - mix.fadeOut)}:d=${mix.fadeOut}[aout]`)
  return filters
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

async function renderSegment({ root, moment, mode, config, file, zooms }) {
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
    await ffmpeg(['-i', clip, ...silence, '-filter_complex', `${takeVideo(moment, fit, seconds, zooms)}[v]`, '-map', '[v]', ...audio, ...encode])
    return
  }
  if (moment.kind === 'photo') {
    const frames = Math.round(Number(moment.seconds) * fps)
    const zoom = `${highlightBoxes(moment.highlights)}scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},${photoMove(moment.highlights, frames, W, H, fps)},setsar=1,${sameFormat}`
    await ffmpeg(['-i', materialPath(root, moment.file), ...silence, '-map', '0:v', '-map', '1:a', '-vf', zoom, ...encode])
    return
  }
  const fallback = moment.kind === 'card' ? '0x111111' : '0x2a3442'
  const color = /^(0x[0-9a-fA-F]{6}|[a-z]{3,20})$/.test(String(moment.background ?? '')) ? moment.background : fallback
  await ffmpeg(['-f', 'lavfi', '-t', seconds, '-i', `color=c=${color}:s=${W}x${H}:r=${fps}`, ...silence, '-map', '0:v', '-map', '1:a', '-vf', sameFormat, ...encode])
}

/** SVG 여러 장을 PNG 로 그린다(AppKit). items: [{ svg, out, width, height }] */
export async function renderSvg(items, work) {
  const spec = join(work, `svg-${Date.now()}-${Math.round(Math.random() * 1e6)}.json`)
  await writeFile(spec, JSON.stringify({ items }))
  await run('osascript', ['-l', 'JavaScript', SVG, spec])
}

// 띠형: 틀 SVG 를 화면 크기로 그리고, 이어 붙인 장면을 창 자리에 둥근 모서리로 잘라 얹는다. 소리는 장면 것을 그대로 쓴다.
async function composeBand({ band, content, out, work, config, seconds }) {
  const { width: W, height: H, fps } = config
  const { x, y, w, h, radius } = band.content
  const frame = join(work, 'frame.png')
  const mask = join(work, 'window.png')
  const maskSvg = join(work, 'window.svg')
  await writeFile(maskSvg, `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><rect width="${w}" height="${h}" rx="${radius}" ry="${radius}" fill="#ffffff"/></svg>`)
  await renderSvg([{ svg: band.svg, out: frame, width: W, height: H }, { svg: maskSvg, out: mask, width: w, height: h }], work)
  await ffmpeg([
    '-loop', '1', '-framerate', String(fps), '-i', frame,
    '-i', content,
    '-loop', '1', '-framerate', String(fps), '-i', mask,
    '-filter_complex', `[2:v]format=rgba,alphaextract[m];[1:v]format=rgba[c];[c][m]alphamerge[win];[0:v]format=rgba[bg];[bg][win]overlay=${x}:${y}:shortest=1,scale=out_range=tv:out_color_matrix=bt709,format=yuv420p[v]`,
    '-map', '[v]', '-map', '1:a', '-t', String(seconds),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', String(fps),
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-c:a', 'copy', out,
  ])
}

// 사진 위 강조(moments[].highlights, 사진 비율의 상자): 반투명 노란 판과 진한 테두리를 사진에 직접 그리고, 카메라는 가운데 대신
// 첫 강조 상자 쪽으로 다가간다 — 캡처를 확대만 하면 어디를 보라는지 모른다(블라인드 비교에서 기준 영상의 형광 강조가 앞섰다).
function highlightBoxes(highlights = []) {
  return highlights.map((box) => {
    const at = `x=iw*${box.x}:y=ih*${box.y}:w=iw*${box.w}:h=ih*${box.h}`
    return `drawbox=${at}:color=0xFFD600@0.35:t=fill,drawbox=${at}:color=0xFFC400@0.95:t=6,`
  }).join('')
}

function photoMove(highlights = [], frames, W, H, fps) {
  const target = highlights[0]
  if (!target) return `zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps}`
  const cx = Number(target.x) + Number(target.w) / 2
  const cy = Number(target.y) + Number(target.h) / 2
  return `zoompan=z='min(zoom+0.0025,1.25)':x='max(0,min(iw-iw/zoom,iw*${cx}-iw/zoom/2))':y='max(0,min(ih-ih/zoom,ih*${cy}-ih/zoom/2))':d=${frames}:s=${W}x${H}:fps=${fps}`
}

// 이어 찍은 테이크는 인물을 지키려고 컷 없이 한 번에 찍는다. 이어지는 장면들의 기획 컷 경계마다 화면 배율을 1.0↔1.15 로
// 번갈아 바꿔(펀치인) 인물은 그대로 두고 화면만 바꾼다. 576p 원본을 더 키우므로 1.18배를 넘기지 않는다.
const PUNCH_IN = 1.15

// 장면 id → 샷마다 확대 여부, 그리고 렌더러가 아는 컷 시각들 — 펀치인으로 배율이 바뀌는 시각과 이어 찍지 않은 새 장면이
// 시작하는 시각. 비슷한 화면끼리 넘어가면 장면 점수(0.3)가 컷을 놓쳐 "한 화면"으로 잘못 경고했다(레시피 실측 10초).
function punchIns(plan) {
  const zooms = new Map()
  const edits = []
  let shown = false
  let cursor = 0
  for (const moment of plan.moments) {
    const shots = moment.shots?.length ? moment.shots : [{ seconds: moment.seconds }]
    if (moment.kind === 'take' && moment.from?.take) {
      const flags = []
      let at = cursor
      for (const shot of shots) {
        const zoom = !shown
        flags.push(zoom)
        edits.push(Math.round(at * 1000) / 1000)
        shown = zoom
        at += Number(shot.seconds)
      }
      zooms.set(moment.id, flags)
    } else {
      if (cursor > 0) edits.push(Math.round(cursor * 1000) / 1000)
      shown = false
    }
    cursor += Number(moment.seconds)
  }
  return { zooms, edits }
}

function takeVideo(moment, fit, seconds, zooms) {
  const hold = `tpad=stop_mode=clone:stop_duration=${seconds}`
  if (!zooms) return `[0:v]${fit},${hold}`
  const shots = moment.shots?.length ? moment.shots : [{ seconds }]
  const parts = []
  let start = 0
  shots.forEach((shot, index) => {
    const end = index === shots.length - 1 ? Number(seconds) + 1 : start + Number(shot.seconds)
    const zoom = zooms[index] ? `crop=iw/${PUNCH_IN}:ih/${PUNCH_IN},` : ''
    parts.push(`[p${index}]trim=start=${start}:end=${end},setpts=PTS-STARTPTS,${zoom}${fit}[q${index}]`)
    start += Number(shot.seconds)
  })
  const split = `[0:v]${hold},split=${shots.length}${shots.map((_, index) => `[p${index}]`).join('')}`
  return `${split};${parts.join(';')};${shots.map((_, index) => `[q${index}]`).join('')}concat=n=${shots.length}:v=1:a=0`
}

// 등장 동작: 상자·칩은 작게 시작해 살짝 넘쳤다가 제자리로(팝, 약 0.25초), 자막은 짧은 페이드. 프레임마다 { scale, alpha }.
const ENTRANCES = {
  pop: [[0.72, 0.5], [0.9, 0.85], [1.03, 1], [1.06, 1], [1.02, 1], [1, 1]],
  fade: [[1, 0.35], [1, 0.7], [1, 1]],
  none: [[1, 1]],
}
async function renderCaptions(events, directory, config, look) {
  if (events.length === 0) return []
  const items = events.map((event, index) => {
    const box = captionBox(event, config)
    const design = box.style === 'plain' ? undefined : designFor(look, event.role, event.look)
    const frames = ENTRANCES[design?.entrance ?? 'none'].map(([scale, alpha]) => ({ scale, alpha }))
    return {
      ...box,
      fontSize: Math.round(box.fontSize * (design?.size ?? 1)),
      ...(design ? { design } : {}),
      ...(box.label ? { labelDesign: designFor(look, 'label') } : {}),
      frames,
      out: join(directory, `cap-${String(index).padStart(2, '0')}`),
    }
  })
  const extraFonts = events.map((event) => event.look?.font).filter(Boolean)
  const spec = join(directory, 'spec.json')
  await writeFile(spec, JSON.stringify({ width: config.width, height: config.height, font: config.font, fontFiles: await fontFiles(look, config, extraFonts), items }))
  const { stdout } = await run('osascript', ['-l', 'JavaScript', JXA, spec])
  const drawn = JSON.parse(stdout)
  return events.map((event, index) => ({
    pattern: `${items[index].out}-%02d.png`,
    start: event.start,
    end: event.end,
    text: event.text,
    role: event.role,
    bounds: drawn[index],
  }))
}

// 화면 문구(자막 띠 제외)가 그 순간의 글자 없는 화면에서 얼굴·주인공 사물을 가리거나 가장자리를 넘는지 잰다.
// 결과는 out/text-check.json 과 render 출력으로 남기고, 에이전트가 caption.position·look 으로 옮겨 다시 render 한다.
const SUBTITLE_ROLES = new Set(['narration', 'dialogue'])
// 자리가 정해진 글자(자막 띠, 띠형의 위 제목·번호)는 가림 검사로 옮기지 않는다.
const FIXED_ROLES = new Set([...SUBTITLE_ROLES, 'headline', 'badge'])

// 사람이 옆 가장자리에 닿은 장면은 잘린 쪽에 보이는 절반을 거울로 붙인 그림을 만들어 얼굴을 다시 찾는다 — 모자·후드를 써서
// 윤곽으로 머리를 어림할 수 없는 옆으로 잘린 얼굴을 잡는다(textcheck.mirroredFaces).
async function findMirroredFaces(scenes, stills, fromTop) {
  const mirrors = []
  for (const [index, scene] of scenes.entries()) {
    for (const side of cutSides(scene.person)) {
      const file = stills[index].replace(/\.png$/, `-mirror-${side}.png`)
      const strip = `crop=iw*${MIRROR_PAD}:ih:${side === 'left' ? 0 : `iw*${1 - MIRROR_PAD}`}:0,hflip`
      const stack = side === 'left' ? '[s][b]hstack' : '[b][s]hstack'
      await ffmpeg(['-i', stills[index], '-filter_complex', `[0]split[a][b];[a]${strip}[s];${stack}`, file])
      mirrors.push({ index, side, file })
    }
  }
  if (mirrors.length === 0) return
  const { stdout } = await run('osascript', ['-l', 'JavaScript', VISION, '--faces', ...mirrors.map((mirror) => mirror.file)])
  JSON.parse(stdout).forEach((faces, order) => {
    const { index, side } = mirrors[order]
    scenes[index].mirrored = [...(scenes[index].mirrored ?? []), ...mirroredFaces(faces.map((face) => fromTop(face)), side)]
  })
}
const SAMPLE_EVERY = 0.8
const MAX_SAMPLES = 5

function sampleTimes(start, end) {
  const first = Math.min(start + 0.4, (start + end) / 2)
  const last = Math.max(first, end - 0.3)
  const count = Math.min(MAX_SAMPLES, Math.max(1, Math.round((last - first) / SAMPLE_EVERY) + 1))
  return Array.from({ length: count }, (_, index) => (count === 1 ? first : first + ((last - first) * index) / (count - 1)))
}

// AppKit 좌표(아래에서 잰 픽셀)를 위에서 잰 0~1 비율로.
function fromTop(rect, width = 1, height = 1) {
  return { x: rect.x / width, y: 1 - (rect.y + rect.h) / height, w: rect.w / width, h: rect.h / height }
}

// 글자 없는 화면 여러 장에서 얼굴·주인공 사물을 찾는다. sampled 는 문구마다 몇 장을 봤는지 — 문구마다 { faces, subjects } 를 돌려준다.
async function findOnScreen(stills, sampled, config) {
  const { stdout } = await run('osascript', ['-l', 'JavaScript', VISION, ...stills])
  const scenes = JSON.parse(stdout)
  await findMirroredFaces(scenes, stills, fromTop)
  // 얼굴은 감지된 것과, 감지되지 않았지만 사람 영역이 화면 윗변·옆 가장자리에 닿아 잘린 것으로 보이는 머리를 함께 본다.
  const faces = (scene) => {
    const detected = [...scene.faces.map((face) => fromTop(face)), ...(scene.mirrored ?? [])]
    const hands = (scene.hands ?? []).map((hand) => fromTop(hand))
    return [...detected, ...croppedHeads(scene.person, detected, { aspect: config.width / config.height, hands, skin: scene.skin })]
  }
  let next = 0
  return sampled.map((count) => {
    const mine = scenes.slice(next, next + count)
    next += count
    return {
      faces: mine.flatMap(faces),
      // 어림한 잘린 머리를 뺀, 실제로 감지된 얼굴(표지 후보 고르기용). 가림 검사는 어림한 머리까지 본다.
      detectedFaces: mine.flatMap((scene) => scene.faces.map((face) => fromTop(face))),
      subjects: mine.flatMap((scene) => scene.subjects).map((subject) => fromTop(subject)),
    }
  })
}

// 화면 문구(자막 띠 제외)가 떠 있는 동안의 글자 없는 화면에서 얼굴·주인공 사물을 찾는다. 문구(이벤트 번호)마다 { faces, subjects }.
// 화면이 움직이므로 등장 직후부터 사라지기 직전까지 약 0.8초마다(최대 5장) 본다 — 두 장만 보면 그 사이에 지나가는 클로즈업을
// 놓쳤다(리뷰 훅 1.8초).
async function lookOnScreen({ base, work, captions, config }) {
  const placed = [...captions.entries()].filter(([, caption]) => !FIXED_ROLES.has(caption.role) && caption.bounds)
  if (placed.length === 0) return new Map()
  const stills = []
  const sampled = []
  for (const [index, caption] of placed) {
    const moments = sampleTimes(caption.start, caption.end)
    sampled.push(moments.length)
    for (const [order, at] of moments.entries()) {
      const still = join(work, `check-${String(index).padStart(2, '0')}-${order}.png`)
      await ffmpeg(['-ss', String(at), '-i', base, '-frames:v', '1', still])
      stills.push(still)
    }
  }
  const found = await findOnScreen(stills, sampled, config)
  return new Map(placed.map(([index], order) => [index, found[order]]))
}

// 자리를 정하지 않은 문구(position 없음)가 얼굴·주인공을 가리면 가리지 않는 가장 가까운 높이로 옮긴다(placement.mjs).
// events 의 position·look.size 를 고쳐 두고, 옮긴 것을 돌려준다 — 고친 events 로 글자를 다시 그린다.
const POSITION_RANGE = [0.08, 0.7]

function autoPlace({ events, captions, seen, config, look, range }) {
  const moved = []
  for (const [index, found] of seen) {
    const event = events[index]
    if (event.position !== undefined || event.card) continue
    const box = fromTop(captions[index].bounds, config.width, config.height)
    const choice = choosePlacement({ box, ...found, range })
    if (!choice.moved) continue
    event.position = { y: Math.round((choice.box.y + choice.box.h / 2) * 1000) / 1000 }
    if (choice.scale !== 1) event.look = { ...event.look, size: Math.round((designFor(look, event.role, event.look)?.size ?? 1) * choice.scale * 100) / 100 }
    moved.push({ text: event.text, start: event.start, from: Math.round((box.y + box.h / 2) * 100) / 100, to: event.position.y, scale: choice.scale })
  }
  return moved
}

// 결과는 out/text-check.json 과 render 출력으로 남기고, 남은 가림은 에이전트가 caption.position·look 으로 옮겨 다시 render 한다.
async function checkPlacement({ root, captions, seen, config, checkFile }) {
  const report = [...seen].map(([index, found]) => {
    const caption = captions[index]
    const box = fromTop(caption.bounds, config.width, config.height)
    return { text: caption.text, role: caption.role, start: caption.start, box, problems: textProblems({ box, ...found }) }
  })
  if (report.length === 0) return []
  await mkdir(join(root, 'out'), { recursive: true })
  await writeFile(join(root, 'out', checkFile), `${JSON.stringify(report, null, 2)}\n`)
  return report.filter((entry) => entry.problems.length)
}

// 묶음의 글꼴(SIL OFL)을 이 PC 에 받아 둔다. 받지 못하면 시스템 글꼴로 그린다(가짜 모드는 받지 않고 있는 것만 쓴다).
async function fontFiles(look, config, extra = []) {
  const directory = join(userConfigDir(), 'fonts')
  const files = []
  for (const name of new Set([...lookFonts(look), ...extra])) {
    const font = FONTS.find((candidate) => candidate.name === name)
    const file = join(directory, font.file)
    if (await access(file).then(() => true, () => false)) {
      files.push(file)
      continue
    }
    if (config.fake) continue
    try {
      files.push(await ensureAsset(font, directory))
    } catch (error) {
      console.log(`! 글꼴 ${name} 을(를) 받지 못했다(${error.message}) — 시스템 글꼴로 그린다`)
    }
  }
  return files
}

function round(value) {
  return Math.round(value * 1000) / 1000
}
