import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const script = new URL('../import-viskit-knowledge.py', import.meta.url).pathname
const FS = 'apps/viskit/backend/pipeline/workflow/freeform_short'
const hasPython = await exec('python3', ['--version']).then(() => true, () => false)

test('importer reads string constants without executing the source and keeps runtime-only values as placeholders', { skip: !hasPython && 'needs python3' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'sd-import-'))
  try {
    const repo = join(root, 'repo')
    await mkdir(join(repo, FS, 'skills/genres'), { recursive: true })
    await writeFile(join(repo, FS, 'prompts.py'), [
      'import os',
      'os.system("touch SHOULD_NOT_RUN")',
      'RULE = "규칙 문장"',
      '_AGENT_SYSTEM = ("""\n원칙 문장 하나.\n{rule}\n{catalog}\n""".replace("{rule}", RULE).replace("{catalog}", skills.plan_catalog()))',
      'DEPTH = 3',
      '_PRODUCTION_SYSTEM = f"""컷은 {DEPTH}개 이상"""',
    ].join('\n'))
    await writeFile(join(repo, FS, 'skills/techniques.py'), 'TECHNIQUES = {"hook": SkillSpec(key="hook", plan="훅 본문 예시 문장이다. 이 줄은 마흔 글자를 넘기기 위해 조금 길게 적었다.")}\n')
    await writeFile(join(repo, FS, 'skills/genres/ad.md'), '---\nlabel: 광고\n---\n<!-- plan -->\n광고 장르\n')

    const out = join(root, 'project', 'knowledge')
    const { stdout } = await exec('python3', ['-I', script, '--from', repo, '--out', out])
    assert.match(stdout, /✓ planning\.md/)
    assert.match(stdout, /건너뜀/, 'missing sources are reported, not fatal')

    const planning = await readFile(join(out, 'planning.md'), 'utf8')
    assert.match(planning, /원칙 문장 하나/)
    assert.match(planning, /규칙 문장/)
    assert.match(planning, /\{catalog\}/)
    assert.match(planning, /커밋·공유 금지/)
    assert.match(await readFile(join(out, 'production.md'), 'utf8'), /컷은 3개 이상/)
    assert.match(await readFile(join(out, 'hook.md'), 'utf8'), /hook · plan/)
    assert.match(await readFile(join(out, 'genres/ad.md'), 'utf8'), /광고 장르/)
    const source = JSON.parse(await readFile(join(out, 'SOURCE.json'), 'utf8'))
    assert.ok(source.files.includes('planning.md'))
    await assert.rejects(readFile(join(root, 'project', 'SHOULD_NOT_RUN')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
