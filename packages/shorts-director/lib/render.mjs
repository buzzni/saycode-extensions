// 애니매틱(draft)과 완성본(final) 조립. 장면마다 같은 규격의 조각을 만들고 이어 붙인 뒤,
// 내레이션을 깔고 글자 PNG 를 시간대별로 겹친다.
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { FONTS, MUSIC, ensureAsset } from './assets.mjs'
import { captionBox, captionEvents } from './captions.mjs'
import { designFor, lookFonts } from './looks.mjs'
import { userConfigDir } from './config.mjs'
import { ffmpeg, probe, run } from './media.mjs'
import { SFX_KINDS, sfxEvents } from './sfx.mjs'
import { materialPath } from './takeState.mjs'

// pathname 은 퍼센트 인코딩이라 공백·한글이 든 설치 경로에서 깨진다.
const JXA = fileURLToPath(new URL('./caption.jxa.js', import.meta.url))

export async function renderVideo({ root, plan, config, mode, narration = [], out }) {
  const { width, height, fps } = config
  const work = join(root, '.work', mode)
  await rm(work, { recursive: true, force: true })
  await mkdir(join(work, 'captions'), { recursive: true })

  const framing = mode === 'final' ? punchIns(plan) : { zooms: new Map(), edits: [] }
  const segments = []
  for (const [index, moment] of plan.moments.entries()) {
    const file = join(work, `seg-${String(index).padStart(2, '0')}.mp4`)
    await renderSegment({ root, moment, mode, config, file, zooms: framing.zooms.get(moment.id) })
    segments.push(file)
  }
  const list = join(work, 'segments.txt')
  await writeFile(list, segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n'))
  const base = join(work, 'base.mp4')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', base])

  const events = [...(mode === 'draft' ? storyboardEvents(plan) : []), ...captionEvents(plan, narration)]
  const captions = await renderCaptions(events, join(work, 'captions'), config, plan.look)
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
  return { out, seconds: total, captions: captions.length, sounds: sounds.length, edits: framing.edits }
}

export async function contactSheet(input, out, { every = 1.5, columns = 6, tileWidth = 240 } = {}) {
  const { duration } = await probe(input)
  const rows = Math.max(1, Math.ceil(Math.ceil(duration / every) / columns))
  await ffmpeg(['-i', input, '-vf', `fps=1/${every},scale=${tileWidth}:-2,tile=${columns}x${rows}:padding=4:color=white`, '-frames:v', '1', out])
  return out
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
    const zoom = `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},zoompan=z='min(zoom+0.0009,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${fps},setsar=1,${sameFormat}`
    await ffmpeg(['-i', materialPath(root, moment.file), ...silence, '-map', '0:v', '-map', '1:a', '-vf', zoom, ...encode])
    return
  }
  const fallback = moment.kind === 'card' ? '0x111111' : '0x2a3442'
  const color = /^(0x[0-9a-fA-F]{6}|[a-z]{3,20})$/.test(String(moment.background ?? '')) ? moment.background : fallback
  await ffmpeg(['-f', 'lavfi', '-t', seconds, '-i', `color=c=${color}:s=${W}x${H}:r=${fps}`, ...silence, '-map', '0:v', '-map', '1:a', '-vf', sameFormat, ...encode])
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
    const design = box.style === 'plain' ? undefined : designFor(look, event.role)
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
  const spec = join(directory, 'spec.json')
  await writeFile(spec, JSON.stringify({ width: config.width, height: config.height, font: config.font, fontFiles: await fontFiles(look, config), items }))
  await run('osascript', ['-l', 'JavaScript', JXA, spec])
  return events.map((event, index) => ({ pattern: `${items[index].out}-%02d.png`, start: event.start, end: event.end }))
}

// 묶음의 글꼴(SIL OFL)을 이 PC 에 받아 둔다. 받지 못하면 시스템 글꼴로 그린다(가짜 모드는 받지 않고 있는 것만 쓴다).
async function fontFiles(look, config) {
  const directory = join(userConfigDir(), 'fonts')
  const files = []
  for (const name of lookFonts(look)) {
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
