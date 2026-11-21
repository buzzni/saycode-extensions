// 테이크 생성 작업 상태 기계. 제출 직후 원격 id 를 먼저 기록해, 확인이 끊겨도 다시 생성하지 않고
// 그 작업을 다시 확인만 한다 — GPU 대기열에 같은 작업이 두 번 쌓이지 않게 하는 장치다.
// 막힌 작업은 `takes forget` 이 failed 로 닫는다(planned·ready·needs_user 에서도).
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const TRANSITIONS = {
  planned: ['submitting', 'failed'],
  submitting: ['submitted', 'failed', 'unknown', 'blocked', 'quota_exhausted', 'needs_user'],
  submitted: ['generating', 'ready', 'unknown', 'failed', 'blocked'],
  generating: ['ready', 'unknown', 'failed', 'blocked'],
  ready: ['downloaded', 'unknown', 'failed'],
  unknown: ['generating', 'ready', 'downloaded', 'failed', 'blocked'],
  needs_user: ['submitting', 'failed'],
  downloaded: [],
  failed: [],
  blocked: [],
  quota_exhausted: [],
}
const TERMINAL = new Set(['downloaded', 'failed', 'blocked', 'quota_exhausted'])

// 생성 결과를 바꾸는 값 전부(장면 id 제외)의 해시. 같은 요청은 다른 장면에서도 재사용한다.
export function promptHash(take) {
  const { momentId, ...request } = take
  const key = Object.fromEntries(Object.entries(request).sort(([left], [right]) => left.localeCompare(right)))
  return createHash('sha256').update(JSON.stringify(key)).digest('hex')
}

export class JobStore {
  constructor(projectRoot) {
    this.directory = join(projectRoot, 'jobs')
  }

  async list() {
    let names = []
    try {
      names = await readdir(this.directory)
    } catch (error) {
      if (error.code === 'ENOENT') return []
      throw error
    }
    const jobs = []
    for (const name of names.filter((item) => item.endsWith('.json')).sort()) {
      jobs.push(JSON.parse(await readFile(join(this.directory, name), 'utf8')))
    }
    return jobs
  }

  async get(id) {
    return JSON.parse(await readFile(this.path(id), 'utf8'))
  }

  async create(take, backend) {
    const hash = promptHash(take)
    const inFlight = (await this.list()).find((job) => job.promptHash === hash && !TERMINAL.has(job.state))
    if (inFlight) throw new Error(`a job for this take is already in flight: ${inFlight.id} (${inFlight.state})`)
    const now = new Date().toISOString()
    const job = {
      id: `${take.momentId}-${hash.slice(0, 8)}-${randomBytes(2).toString('hex')}`,
      momentId: take.momentId,
      backend,
      promptHash: hash,
      take,
      state: 'planned',
      createdAt: now,
      history: [{ state: 'planned', at: now }],
    }
    await this.write(job)
    return job
  }

  async transition(id, state, data = {}) {
    const job = await this.get(id)
    if (!TRANSITIONS[job.state]?.includes(state)) {
      throw new Error(`illegal job transition ${job.state} → ${state} (${id})`)
    }
    const at = new Date().toISOString()
    const next = { ...job, ...data, state, updatedAt: at, history: [...job.history, { state, at, ...(data.reason ? { reason: data.reason } : {}) }] }
    await this.write(next)
    return next
  }

  path(id) {
    return join(this.directory, `${id}.json`)
  }

  async write(job) {
    await mkdir(this.directory, { recursive: true })
    const temporary = `${this.path(job.id)}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(job, null, 2)}\n`)
    await rename(temporary, this.path(job.id))
  }
}
