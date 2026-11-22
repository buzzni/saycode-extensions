// ffmpeg·ffprobe·osascript 호출과 미디어 조회.
import { execFile } from 'node:child_process'
import { access, rm } from 'node:fs/promises'
import { promisify } from 'node:util'

const exec = promisify(execFile)

export async function run(command, args, { cwd } = {}) {
  try {
    return await exec(command, args, { cwd, maxBuffer: 64 * 1024 * 1024 })
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${command} 이(가) 설치돼 있지 않다 — README 의 준비물을 확인한다.`)
    const tail = String(error.stderr ?? '').trim().split('\n').slice(-12).join('\n')
    throw new Error(`${command} failed (${error.code}):\n${tail}`)
  }
}

export function ffmpeg(args, options) {
  return run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], options)
}

export async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', file])
  const json = JSON.parse(stdout)
  const video = json.streams?.find((stream) => stream.codec_type === 'video')
  return {
    duration: Number(json.format?.duration ?? 0),
    width: video?.width,
    height: video?.height,
    hasAudio: Boolean(json.streams?.some((stream) => stream.codec_type === 'audio')),
  }
}

// TTS 결과의 앞뒤 침묵을 자르고 문장 안의 긴 쉼을 줄인다. 길이를 실측해 영상에 맞추려면 침묵이 섞이면 안 된다
// (Qwen TTS 는 앞 약 1.2초, 뒤 약 0.9초, 쉼표마다 약 0.85초의 침묵을 넣는다).
export async function tightenSpeech(input, output) {
  const edge = 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05'
  // 0.15초 넘는 쉼을 줄여 약 0.27초만 남긴다.
  const pauses = 'silenceremove=stop_periods=-1:stop_duration=0.15:stop_threshold=-45dB:stop_silence=0.1'
  await ffmpeg(['-i', input, '-af', `${edge},areverse,${edge},areverse,${pauses}`, output])
}

// 말 빠르기를 바꾼다(atempo 는 음높이를 유지한다). 1 이면 그대로 옮긴다.
export async function changeTempo(input, output, tempo) {
  await ffmpeg(['-i', input, '-af', tempo === 1 ? 'anull' : `atempo=${tempo.toFixed(3)}`, output])
}

// 영상에서 한 프레임을 PNG 로 뽑는다. at 이 'end' 면 마지막 프레임.
// 끝에서 1초를 디코딩해 같은 파일을 덮어쓰게 해 마지막 프레임이 남게 한다 — 오디오가 영상보다 조금 길면
// 컨테이너 끝 기준 짧은 seek 은 프레임 없이 성공해 버린다(실측). 결과 파일이 없으면 실패로 본다.
export async function extractFrame(video, out, at = 'end') {
  await rm(out, { force: true })
  const input = at === 'end' ? ['-sseof', '-1', '-i', video] : ['-ss', String(at), '-i', video, '-frames:v', '1']
  await ffmpeg([...input, '-map', '0:v:0', '-update', '1', out])
  try {
    await access(out)
  } catch {
    throw new Error(`${video} 에서 프레임을 뽑지 못했다`)
  }
}

// 장면이 바뀐 시각들. 테이크 안의 컷이 프롬프트대로 나왔는지 확인할 때 쓴다.
export async function detectCuts(file, threshold = 0.3) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-filter:v', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Math.round(Number(match[1]) * 100) / 100)
}

// 렌더 결과에서 실제로 화면이 바뀐 시각들로 컷 리듬을 잰다. 이어 찍은 테이크는 기획의 컷이 화면에 나오지 않을 수 있다.
export function rhythmReport(cuts, total, planned) {
  const edges = [0, ...cuts, total]
  let longest = { start: 0, end: total, seconds: total }
  for (let index = 1; index < edges.length; index += 1) {
    const seconds = Math.round((edges[index] - edges[index - 1]) * 100) / 100
    if (index === 1 || seconds > longest.seconds) longest = { start: edges[index - 1], end: edges[index], seconds }
  }
  return { cuts: cuts.length, planned, longest }
}
