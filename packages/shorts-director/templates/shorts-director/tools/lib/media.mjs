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

// 장면이 바뀐 시각들. 테이크 안의 컷이 프롬프트대로 나왔는지 확인할 때 쓴다.
export async function detectCuts(file, threshold = 0.3) {
  const { stderr } = await run('ffmpeg', ['-hide_banner', '-i', file, '-filter:v', `select='gt(scene,${threshold})',showinfo`, '-f', 'null', '-'])
  return [...stderr.matchAll(/pts_time:([\d.]+)/g)].map((match) => Math.round(Number(match[1]) * 100) / 100)
}
