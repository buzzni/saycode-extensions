// plan.json 의 지금 내용에 맞는 테이크가 무엇이고 어디까지 왔는지 계산한다.
// 테이크는 "요청(해시)"으로 찾는다 — 장면 id 나 takes/ 의 파일 이름은 버전을 구분하지 못하기 때문이다.
// 이어 찍는 테이크의 요청에는 시작 테이크의 실제 결과 해시가 들어가서, 앞이 다시 만들어지면 뒤도 새 요청이 된다.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, posix, relative, resolve } from 'node:path'

import { promptHash } from './jobs.mjs'
import { buildTake } from './takes.mjs'

export const ACTIVE_STATES = ['planned', 'submitting', 'submitted', 'generating', 'ready', 'unknown', 'needs_user']
const DEAD_STATES = ['failed', 'blocked', 'quota_exhausted']

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

// materials/ 밖의 파일은 읽지 않는다 — plan.json 이 프로젝트 밖 파일을 서버로 보내지 못하게.
export function materialPath(root, file) {
  const normalized = posix.normalize(String(file ?? ''))
  const absolute = resolve(root, normalized)
  const fromMaterials = relative(join(root, 'materials'), absolute)
  if (isAbsolute(normalized) || !fromMaterials || fromMaterials.startsWith('..') || isAbsolute(fromMaterials)) {
    throw new Error(`materials/ 밖의 파일은 쓸 수 없다: ${file}`)
  }
  return absolute
}

function latest(jobs, states) {
  return jobs
    .filter((job) => states.includes(job.state))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)))
    .at(-1)
}

// 장면 순서대로 { take, hash, done, active, failed, blockedBy, dead } 를 만든다.
export async function resolveTakes(root, plan, config, jobs) {
  const entries = new Map()
  for (const moment of (plan.moments ?? []).filter((item) => item.kind === 'take')) {
    const take = buildTake(moment, plan, config)
    let blockedBy
    if (take.firstFrame?.take) {
      const source = entries.get(take.firstFrame.take)
      if (source?.done) take.firstFrame.sourceSha256 = source.done.sha256
      else blockedBy = take.firstFrame.take
    } else if (take.firstFrame?.file) {
      take.firstFrame.fileSha256 = sha256(await readFile(materialPath(root, take.firstFrame.file)))
    }
    const hash = blockedBy ? undefined : promptHash(take)
    const mine = hash ? jobs.filter((job) => job.promptHash === hash) : []
    const done = latest(mine, ['downloaded'])
    const active = done ? undefined : latest(mine, ACTIVE_STATES)
    const failed = done || active ? undefined : latest(mine, DEAD_STATES)
    const sourceDead = blockedBy ? entries.get(blockedBy)?.dead : false
    entries.set(moment.id, { moment, take, hash, done, active, failed, blockedBy, dead: Boolean(failed || sourceDead) })
  }
  return entries
}
