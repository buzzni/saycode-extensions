// 프로젝트 설정(config/settings.json)과 .env 읽기. 서버 주소·토큰은 .env 에만 둔다(패키지에 싣지 않는다).
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const DEFAULTS = {
  fake: false,
  autopilot: false,
  // 완성본 규격. 생성 영상(video.width×height)은 여기에 맞춰 늘린다.
  width: 1080,
  height: 1920,
  fps: 30,
  font: 'AppleSDGothicNeo-Heavy',
  video: { width: 576, height: 1024, fps: 24 },
  voice: { language: 'korean', speaker: 'sohee', start: 0.2, gap: 0.3 },
  mix: { underNarration: 0.3 },
}

export async function loadConfig(root) {
  let user = {}
  try {
    user = JSON.parse(await readFile(join(root, 'config', 'settings.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`config/settings.json 을 읽지 못했다: ${error.message}`)
  }
  return merge(DEFAULTS, user)
}

export async function loadEnv(root) {
  const env = {}
  try {
    for (const line of (await readFile(join(root, '.env'), 'utf8')).split('\n')) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
    }
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const merged = { ...env, ...pick(process.env, ['LTX_URL', 'QWEN_TTS_URL', 'QWEN_TTS_TOKEN']) }
  if (!merged.QWEN_TTS_TOKEN) merged.QWEN_TTS_TOKEN = await readTokenFile()
  return merged
}

// 토큰은 프로젝트 밖 사용자 설정 폴더에 둘 수도 있다(여러 프로젝트에서 같이 쓰고, 프로젝트를 공유해도 새지 않게).
async function readTokenFile() {
  try {
    return (await readFile(join(homedir(), '.config', 'shorts-director', 'tts-token'), 'utf8')).trim() || undefined
  } catch {
    return undefined
  }
}

function merge(base, override) {
  if (!isObject(base) || !isObject(override)) return override === undefined ? base : override
  const out = { ...base }
  for (const [key, value] of Object.entries(override)) out[key] = merge(base[key], value)
  return out
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function pick(source, keys) {
  return Object.fromEntries(keys.filter((key) => source[key]).map((key) => [key, source[key]]))
}
