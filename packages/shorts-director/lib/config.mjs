// 프로젝트 설정(config/settings.json)과 서버 주소·토큰 읽기. 주소·토큰은 패키지에 싣지 않는다.
// 우선순위: 셸 환경 변수 > 프로젝트 .env > 이 PC 의 ~/.config/shorts-director/.env > (토큰만) ~/.config/shorts-director/tts-token
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
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

const KEYS = ['LTX_URL', 'QWEN_TTS_URL', 'QWEN_TTS_TOKEN']

export function userConfigDir(home = homedir()) {
  return join(home, '.config', 'shorts-director')
}

export async function loadEnv(root, { home = homedir() } = {}) {
  const user = await readEnvFile(join(userConfigDir(home), '.env'))
  const project = await readEnvFile(join(root, '.env'))
  const merged = { ...user, ...project, ...pick(process.env, KEYS) }
  if (!merged.QWEN_TTS_TOKEN) merged.QWEN_TTS_TOKEN = await readTokenFile(home)
  if (!merged.QWEN_TTS_TOKEN) delete merged.QWEN_TTS_TOKEN
  return merged
}

// 이 PC 의 설정 파일에 빠진 값만 더한다. 이미 있는 값은 바꾸지 않는다. 더한 키 이름을 돌려준다.
export async function saveUserEnv(values, { home = homedir() } = {}) {
  const directory = userConfigDir(home)
  const file = join(directory, '.env')
  let text = ''
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  const existing = parseEnv(text)
  const added = Object.entries(values).filter(([key, value]) => value && !existing[key])
  if (added.length === 0) return []
  await mkdir(directory, { recursive: true })
  const prefix = text && !text.endsWith('\n') ? '\n' : ''
  await writeFile(file, `${text}${prefix}${added.map(([key, value]) => `${key}=${value}`).join('\n')}\n`)
  await chmod(file, 0o600)
  return added.map(([key]) => key)
}

async function readEnvFile(file) {
  try {
    return parseEnv(await readFile(file, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw error
  }
}

function parseEnv(text) {
  const env = {}
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
    if (match) env[match[1]] = match[2].replace(/^["']|["']$/g, '')
  }
  return env
}

// 토큰은 프로젝트 밖 사용자 설정 폴더에 둔다(여러 프로젝트에서 같이 쓰고, 프로젝트를 공유해도 새지 않게).
async function readTokenFile(home) {
  try {
    return (await readFile(join(userConfigDir(home), 'tts-token'), 'utf8')).trim() || undefined
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
