// 프로젝트 설정(config/settings.json)과 서버 주소·토큰 읽기. 주소·토큰은 패키지에 싣지 않는다.
// 우선순위: 셸 환경 변수 > 프로젝트 .env > 저장소 루트 .env > 이 PC 의 ~/.config/shorts-director/.env > (토큰만) ~/.config/shorts-director/tts-token
import { access, chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export const DEFAULTS = {
  fake: false,
  autopilot: false,
  // 완성본 규격. 생성 영상(video.width×height)은 여기에 맞춰 늘린다. 프레임 수(fps)는 따로 정하지 않으면 생성 영상을 따른다 —
  // 24fps 영상을 30fps 로 내면 5장마다 1장이 겹쳐 움직임이 걸린다.
  width: 1080,
  height: 1920,
  font: 'AppleSDGothicNeo-Heavy',
  video: { width: 576, height: 1024, fps: 24 },
  voice: { language: 'korean', speaker: 'sohee', start: 0.2, gap: 0.1, syllablesPerSecond: 6.5, maxTempo: 1.25 },
  // 덕킹: 내레이션이 들리는 동안만 장면 소리·배경음을 누른다. music 은 plan.music 의 기본 크기.
  mix: { duck: { threshold: 0.02, ratio: 8, attack: 20, release: 300 }, music: 0.12, sfx: 0.5, fadeOut: 0.5 },
}

export async function loadConfig(root) {
  let user = {}
  try {
    user = JSON.parse(await readFile(join(root, 'config', 'settings.json'), 'utf8'))
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`config/settings.json 을 읽지 못했다: ${error.message}`)
  }
  const config = merge(DEFAULTS, user)
  if (user.fps === undefined) config.fps = config.video.fps
  return config
}

const KEYS = ['LTX_URL', 'QWEN_TTS_URL', 'QWEN_TTS_TOKEN']
// 프로젝트 쪽 파일. 여기서 바꾼 음성 서버 주소에는 PC 쪽 토큰을 보내지 않는다.
const PROJECT_LAYERS = ['project', 'repository']

export function userConfigDir(home = homedir()) {
  return join(home, '.config', 'shorts-director')
}

export async function loadEnv(root, { home = homedir() } = {}) {
  const layers = await readLayers(root, home)
  const merged = { ...layers.user, ...layers.repository, ...layers.project, ...layers.shell }
  if (!merged.QWEN_TTS_TOKEN && layers.tokenFile) merged.QWEN_TTS_TOKEN = layers.tokenFile
  return merged
}

// 음성 서버 주소와 토큰. 프로젝트 .env 가 주소를 바꿨는데 토큰은 PC 쪽(사용자 설정·토큰 파일)에서 온다면
// 토큰을 보내지 않는다 — 남이 만든 프로젝트를 열었을 때 토큰이 그 프로젝트가 정한 서버로 가지 않게.
export async function loadTts(root, { home = homedir() } = {}) {
  const layers = await readLayers(root, home)
  const source = (key) => ['shell', 'project', 'repository', 'user'].find((layer) => layers[layer][key])
  const urlSource = source('QWEN_TTS_URL')
  const tokenSource = source('QWEN_TTS_TOKEN') ?? (layers.tokenFile ? 'tokenFile' : undefined)
  if (PROJECT_LAYERS.includes(urlSource) && tokenSource && !PROJECT_LAYERS.includes(tokenSource)) {
    throw new Error('프로젝트 .env 가 음성 서버 주소를 바꿨다 — 이 PC 의 토큰을 그 주소로 보내지 않는다. 그 서버를 쓰려면 프로젝트 .env 에 QWEN_TTS_TOKEN 도 둔다.')
  }
  const env = await loadEnv(root, { home })
  return { url: env.QWEN_TTS_URL, token: env.QWEN_TTS_TOKEN }
}

async function readLayers(root, home) {
  return {
    shell: pick(process.env, KEYS),
    project: await readEnvFile(join(root, '.env')),
    repository: await readRepositoryEnv(root),
    user: await readEnvFile(join(userConfigDir(home), '.env')),
    tokenFile: await readTokenFile(home),
  }
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
  if (added.length === 0) {
    if (text) await chmod(file, 0o600)
    return []
  }
  await mkdir(directory, { recursive: true })
  const prefix = text && !text.endsWith('\n') ? '\n' : ''
  await writeFile(file, `${text}${prefix}${added.map(([key, value]) => `${key}=${value}`).join('\n')}\n`, { mode: 0o600 })
  await chmod(file, 0o600)
  return added.map(([key]) => key)
}

// 작업 폴더를 품은 저장소 루트(.git 이 있는 가장 가까운 상위 폴더)의 .env. 작업 환경이 서버 주소·토큰을 여기에 써 준다.
// 작업 폴더가 곧 루트면 프로젝트 .env 와 같은 파일이라 읽지 않고, 저장소 밖이면 상위 폴더의 .env 를 읽지 않는다.
async function readRepositoryEnv(root) {
  const start = resolve(root)
  for (let directory = start; ; directory = dirname(directory)) {
    if (await exists(join(directory, '.git'))) return directory === start ? {} : readEnvFile(join(directory, '.env'))
    if (dirname(directory) === directory) return {}
  }
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
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
