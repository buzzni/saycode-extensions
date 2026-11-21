// 프로젝트 설정(config/settings.json)과 .env 읽기. 키는 .env 에만 둔다.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const DEFAULTS = {
  fake: false,
  autopilot: false,
  width: 1080,
  height: 1920,
  fps: 30,
  aspect: '9:16',
  font: 'AppleSDGothicNeo-Heavy',
  video: {
    resolution: '720p',
    quietLine: 'No subtitles, no captions, no on-screen text. No background music.',
    app: { enabled: false, measured: false, remaining: 0 },
    api: { enabled: true, capUsd: 3, resolution: '720p', costPerSecond: { '360p': 0.023, '720p': 0.07, '1080p': 0.104 } },
  },
  voice: { voice: 'Kore', style: '', start: 0.2, gap: 0.3 },
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
  return { ...env, ...pick(process.env, ['GEMINI_API_KEY']) }
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
