import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import JSZip from 'jszip'
import { JSDOM } from 'jsdom'
import { createTestHost } from '../packages/test-host/dist/index.js'
const root = new URL('..', import.meta.url).pathname
const packageRoot = join(root, 'packages/document-templates')
const execute = promisify(execFile)
const flush = () => new Promise(resolve => setTimeout(resolve, 10))
test('packed template extension owns all 8 references and uses only declared public capabilities', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'document-template-'))
  try {
    const archive = join(temporary, 'template.saycode-extension')
    await execute('node', [join(root, 'packages/sdk/dist/cli.js'), 'pack', packageRoot, '--output', archive])
    const zip = await JSZip.loadAsync(await readFile(archive))
    const manifest = JSON.parse(await zip.file('extension.json').async('string'))
    assert.deepEqual(manifest.permissions, ['assets.read', 'assets.write', 'files.select', 'drafts.prepare'])
    assert.equal(manifest.engines.saycode, '^1.1.0')
    const entry = join(temporary, 'index.mjs')
    await writeFile(entry, await zip.file('index.js').async('nodebuffer'))
    const extension = (await import(pathToFileURL(entry).href)).default
    const calls = []
    const host = createTestHost(manifest.id, { invokeCapability: async (...args) => {
      calls.push(args)
      if (args[1] === 'update') throw new Error(args[2].name === 'bad-format' ? 'UNSUPPORTED_FORMAT' : 'INVALID_REQUEST')
      return { templates: [] }
    } })
    await host.activate(extension)
    const catalog = await host.invokeCommand('buzzni.document-templates.execute', ['catalog'])
    assert.equal(catalog.length, 8)
    for (const row of catalog) {
      const source = await zip.file(`assets/${row.id}/reference.${row.referenceFormat}`).async('nodebuffer')
      assert.equal(createHash('sha256').update(source).digest('hex'), row.sha256)
      assert.ok(zip.file(`assets/${row.id}/preview.png`))
      assert.ok(zip.file(`assets/${row.id}/instructions.md`))
    }
    assert.deepEqual(await host.invokeCommand('buzzni.document-templates.execute', [{ permission: 'assets.read', action: 'list', args: {} }]), { ok: true, value: { templates: [] } })
    assert.deepEqual(calls, [['assets.read', 'list', { version: 1 }]])
    assert.deepEqual(await host.invokeCommand('buzzni.document-templates.execute', [{ permission: 'machine.execute', action: 'run', args: {} }]), { ok: false, error: 'INVALID_REQUEST' })
    // Core validation rejections (e.g. a same-format replacement refused by Web) must reach the panel as-is, not as an outage.
    assert.deepEqual(await host.invokeCommand('buzzni.document-templates.execute', [{ permission: 'assets.write', action: 'update', args: { name: 'x' } }]), { ok: false, error: 'INVALID_REQUEST' })
    assert.deepEqual(await host.invokeCommand('buzzni.document-templates.execute', [{ permission: 'assets.write', action: 'update', args: { name: 'bad-format' } }]), { ok: false, error: 'UNSUPPORTED_FORMAT' })
  } finally { await rm(temporary, { recursive: true, force: true }) }
})
async function panel(invoke, language='en') {
  // Load the packaged panel straight from disk: the test never builds markup from strings.
  const dom = await JSDOM.fromFile(join(packageRoot, 'panel.html'), { runScripts: 'dangerously', url: `https://panel.invalid/?language=${encodeURIComponent(language)}`, beforeParse(window) {
    window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder
    // The real panel runs in an opaque-origin iframe: not a secure context, so no crypto.subtle.
    assert.equal(window.crypto?.subtle, undefined)
    // Core frames panels with sandbox="allow-scripts" only, so the browser never submits a form or fires submit.
    window.addEventListener('submit', event => { event.preventDefault(); event.stopImmediatePropagation() }, true)
    window.saycodePanel = { ready: Promise.resolve(), invokeCommand: async (_, [input]) => {
      if (input === 'catalog') return [{ id: 'design-report', name: 'Report', format: 'docx', referenceFormat: 'docx' }]
      return { ok: true, value: await invoke(input) }
    } }
  } })
  await flush()
  return dom
}
test('panel selection never applies; explicit apply stages then commits the current target', async () => {
  const calls = []
  const dom = await panel(async request => {
    calls.push(request)
    if (request.action === 'list') return { templates: [], cursor: null }
    if (request.action === 'open') return { handle: request.args.path }
    if (request.action === 'readChunk') return { contentBase64: Buffer.from('png').toString('base64'), nextOffset: 3, done: true }
    if (request.action === 'context') return { targetId: 'current', revision: 7, private: false }
    if (request.action === 'prepare') return { preparationId: 'staged' }
    return {}
  })
  try {
    dom.window.document.querySelector('.card').click(); await flush()
    assert.equal(calls.some(call => call.permission === 'drafts.prepare'), false)
    dom.window.document.getElementById('apply').click(); await flush()
    const prepared = calls.find(call => call.action === 'prepare')
    assert.equal(prepared.args.targetId, 'current'); assert.equal(prepared.args.revision, 7)
    assert.equal(prepared.args.handles.length, 2)
    assert.equal(calls.at(-1).action, 'commit')
    assert.match(dom.window.document.getElementById('notice').textContent, /Added to the draft/)
  } finally { dom.window.close() }
})
test('private target refusal does not open originals or commit; management carries expected revision', async () => {
  const calls = []
  const dom = await panel(async request => {
    calls.push(request)
    if (request.action === 'list') return { templates: [{ id: 'personal-example', name: 'Private', format: 'docx' }], cursor: null }
    if (request.action === 'describe') return { revision: 'r1' }
    if (request.action === 'context') return { targetId: 'project', revision: 0, private: false }
    if (request.action === 'open') return { handle: 'h' }
    if (request.action === 'readChunk') return { contentBase64: 'eA==', nextOffset: 1, done: true }
    return {}
  }, 'ko')
  try {
    dom.window.document.querySelectorAll('.card')[1].click(); await flush()
    const before = calls.length
    dom.window.document.getElementById('apply').click(); await flush()
    assert.deepEqual(calls.slice(before).map(c => c.action), ['context'])
    assert.match(dom.window.document.getElementById('notice').textContent, /비공개 개인 대화/)
    dom.window.document.getElementById('remove').click(); await flush()
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c => c.action === 'remove').args)), { id: 'personal-example', expectedRevision: 'r1' })
  } finally { dom.window.close() }
})
test('editing a personal template seals instructions without Web Crypto in the opaque panel origin', async () => {
  const calls = []
  const text = '보존할 서식 — keep headers. '.repeat(1200)
  const dom = await panel(async request => {
    calls.push(request)
    if (request.action === 'list') return { templates: [{ id: 'personal-example', name: 'Private', format: 'docx' }], cursor: null }
    if (request.action === 'describe') return { revision: 'r1' }
    if (request.action === 'open') return { handle: 'h' }
    if (request.action === 'readChunk') return { contentBase64: Buffer.from('old').toString('base64'), nextOffset: 3, done: true }
    if (request.action === 'begin') return { handle: 'upload' }
    if (request.action === 'seal') return { handle: 'sealed' }
    if (request.action === 'update') return { saved: true, warnings: [] }
    return {}
  }, 'ko')
  try {
    const document = dom.window.document
    document.querySelectorAll('.card')[1].click(); await flush()
    document.getElementById('edit').click(); await flush()
    document.getElementById('instructions').value = text
    document.querySelector('#editor [data-label=save]').click(); await flush()
    const bytes = Buffer.from(text, 'utf8')
    const written = Buffer.concat(calls.filter(c => c.action === 'writeChunk').map(c => Buffer.from(c.args.contentBase64, 'base64')))
    assert.equal(written.equals(bytes), true)
    assert.equal(calls.find(c => c.action === 'seal').args.sha256, createHash('sha256').update(bytes).digest('hex'))
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c => c.action === 'update').args)), { id: 'personal-example', expectedRevision: 'r1', name: 'Private', instructionHandle: 'sealed' })
    assert.doesNotMatch(document.getElementById('notice').textContent, /완료하지 못했습니다/)
  } finally { dom.window.close() }
})
test('creating a personal template saves from the button even though the sandbox blocks form submission', async () => {
  const calls = []
  const dom = await panel(async request => {
    calls.push(request)
    if (request.action === 'list') return { templates: [], cursor: null }
    if (request.action === 'pick') return { cancelled: false, handle: 'source', name: 'mine.docx' }
    if (request.action === 'create') return { saved: true, warnings: [] }
    return {}
  }, 'ko')
  try {
    const document = dom.window.document
    document.getElementById('new').click(); await flush()
    document.querySelector('#editor [data-label=save]').click(); await flush()
    assert.equal(calls.some(c => c.action === 'create'), false, 'an empty name must not save')
    document.getElementById('titleInput').value = 'Mine'
    document.getElementById('source').click(); await flush()
    document.querySelector('#editor [data-label=save]').click(); await flush()
    assert.deepEqual(JSON.parse(JSON.stringify(calls.find(c => c.action === 'create').args)), { name: 'Mine', sourceHandle: 'source', preserve: '' })
  } finally { dom.window.close() }
})
test('editing shows and sends only the user-owned instructions; the server re-attaches the source analysis', async () => {
  const calls = []
  const stored = '# 개인 문서 템플릿\n기존 지침\n\n## 원본 구조 분석 (JSON 참고 데이터; 전체 원본은 위 경로에서 읽을 것)\n{"parts":["word/document.xml"]}\n\n예전에 끝에 붙인 지침\n'
  const dom = await panel(async request => {
    calls.push(request)
    if (request.action === 'list') return { templates: [{ id: 'personal-example', name: 'Private', format: 'docx' }], cursor: null }
    if (request.action === 'describe') return { revision: 'r1' }
    if (request.action === 'open') return { handle: request.args.role ?? 'h' }
    if (request.action === 'readChunk') return { contentBase64: Buffer.from(request.args.handle === 'instructions' ? stored : 'png').toString('base64'), nextOffset: 1, done: true }
    if (request.action === 'begin') return { handle: 'upload' }
    if (request.action === 'seal') return { handle: 'sealed' }
    if (request.action === 'update') return { saved: true, warnings: [] }
    return {}
  }, 'ko')
  try {
    const document = dom.window.document
    document.querySelectorAll('.card')[1].click(); await flush()
    document.getElementById('edit').click(); await flush()
    assert.equal(document.getElementById('instructions').value, '# 개인 문서 템플릿\n기존 지침\n\n예전에 끝에 붙인 지침')
    document.getElementById('instructions').value += '\n\n## 추가 지침\n로고 유지'
    document.querySelector('#editor [data-label=save]').click(); await flush()
    const written = Buffer.concat(calls.filter(c => c.action === 'writeChunk').map(c => Buffer.from(c.args.contentBase64, 'base64'))).toString('utf8')
    assert.equal(written, '# 개인 문서 템플릿\n기존 지침\n\n예전에 끝에 붙인 지침\n\n## 추가 지침\n로고 유지')
  } finally { dom.window.close() }
})
