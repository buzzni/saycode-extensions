// ffmpeg·ffprobe·osascript 호출과 미디어 조회.
import { execFile } from 'node:child_process'
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

// 장면이 바뀐 시각들. 테이크 안의 컷이 프롬프트대로 나왔는지 확인할 때 쓴다.
export async function detectCuts(file, threshold = 0.3) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-filter:v', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Math.round(Number(match[1]) * 100) / 100)
}
