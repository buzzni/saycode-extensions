import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { build } from 'esbuild'
import JSZip from 'jszip'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'
import { createTestHost, fakeSlackHistory } from '../packages/test-host/dist/index.js'

const exec = promisify(execFile)
const root = new URL('..', import.meta.url).pathname
const cli = join(root, 'packages/sdk/dist/cli.js')
const packageRoot = join(root, 'packages/slack')

// ---- shared bundling helpers ---------------------------------------------------------------

let bundleDirectory
async function bundleModule(relativeSourcePath) {
  bundleDirectory ??= await mkdtemp(join(tmpdir(), 'saycode-slack-unit-'))
  const outfile = join(bundleDirectory, `${relativeSourcePath.replace(/\W+/g, '-')}-${Date.now()}-${Math.random()}.mjs`)
  await build({
    entryPoints: [join(packageRoot, relativeSourcePath)],
    bundle: true,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    outfile,
    external: ['@buzzni/saycode-extension-sdk'],
  })
  return import(pathToFileURL(outfile).href)
}

async function packedSlack() {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-slack-'))
  const archivePath = join(temporary, 'slack.saycode-extension')
  await exec('node', [cli, 'pack', packageRoot, '--output', archivePath])
  const zip = await JSZip.loadAsync(await readFile(archivePath))
  const modulePath = join(temporary, 'index.mjs')
  await writeFile(modulePath, await zip.file('index.js').async('nodebuffer'))
  const extension = (await import(`${pathToFileURL(modulePath).href}?test=${Date.now()}`)).default
  return { temporary, zip, extension }
}

function envelope(overrides) {
  return {
    eventHandle: 'handle-1',
    connectionRevision: 1,
    semanticMessageId: 'msg-1',
    text: 'hello',
    sender: { bot: false },
    ...overrides,
  }
}

// ---- manifest --------------------------------------------------------------------------------

const CHANNEL_V2_HOST = { supportedApiVersion: 3, minimumSupportedApiVersion: 2, supportedChannelApiVersion: 2, minimumSupportedChannelApiVersion: 1 }

test('Slack manifest declares exactly the channel it uses and nothing wider', async () => {
  const raw = JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8'))
  const manifest = parseExtensionManifest(raw, CHANNEL_V2_HOST)
  assert.equal(manifest.id, 'buzzni.slack')
  // Channel API 2 for thread-history normalization; a Desktop that speaks only channel API 1 refuses it.
  assert.equal(manifest.channelApiVersion, 2)
  assert.throws(
    () => parseExtensionManifest(raw, { ...CHANNEL_V2_HOST, supportedChannelApiVersion: 1, minimumSupportedChannelApiVersion: 1 }),
    /channelApiVersion: unsupported 2/,
  )
  assert.deepEqual(manifest.permissions, ['channels.receive', 'channels.ack', 'channels.send', 'channels.normalize', 'sessions.control', 'sessions.approveOnce'])
  assert.deepEqual(manifest.activationEvents, ['onChannel:buzzni.slack.bot'])
  assert.deepEqual(manifest.contributes.channels, [{ id: 'buzzni.slack.bot', provider: 'slack' }])
})

test('the release workflow publishes the Slack artifact under the manifest version', async () => {
  // The archive is named from extension.json; a stale name in release.yml fails the tag build.
  const { version } = JSON.parse(await readFile(join(packageRoot, 'extension.json'), 'utf8'))
  assert.equal(version, '1.5.0')
  const workflow = await readFile(join(root, '.github/workflows/release.yml'), 'utf8')
  const names = [...workflow.matchAll(/buzzni\.slack-([0-9.]+)\.saycode-extension/g)].map(match => match[1])
  assert.equal(names.length, 3)
  assert.deepEqual([...new Set(names)], [version])
})

test('Slack never actually calls channels.send despite declaring it', async () => {
  const source = await readFile(join(packageRoot, 'src/intakeLoop.ts'), 'utf8')
  const indexSource = await readFile(join(packageRoot, 'src/index.ts'), 'utf8')
  assert.doesNotMatch(source, /'channels\.send'/)
  assert.doesNotMatch(indexSource, /'channels\.send'/)
})

test('Slack packs as an installable API v3 archive', async () => {
  const packed = await packedSlack()
  try {
    assert.deepEqual(Object.keys(packed.zip.files).sort(), ['extension.json', 'index.js'])
    const manifest = JSON.parse(await packed.zip.file('extension.json').async('string'))
    assert.equal(parseExtensionManifest(manifest, CHANNEL_V2_HOST).id, 'buzzni.slack')
    assert.ok(typeof packed.extension.activate === 'function')
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

// ---- Desktop shared fixtures (channel-contract-v2) ------------------------------------------

const contractFixtures = join(packageRoot, 'test/fixtures/channel-contract-v2')
/** sha256 of each file at Desktop d162cbd4aafc0d34f200bb5d4420304fa2d75852 tests/fixtures/channel-contract-v2/. */
const CONTRACT_FIXTURE_SHA256 = {
  'normalize-result.json': '2a94a97261356351b8d112e5a58800b45ce254816b791b0a5a34855f65c2f9b1',
  'normalize/forward.json': 'b2ff8335d7ca1e4eb6355117faf2aa7cb874d2df8e742ff947ba44be5d66ed5b',
  'normalize/quote.json': '448c321beb2c6def47ac73d75f8833656edd61614ed481c44245710e1676678d',
  'normalize/same-text-blocks.json': '39fec781ff4e750f9bcf01d52a5a6881b636cb16bf138ca654e20f1494463167',
  'normalize/table.json': '6b39590cfcc8694c9a35aab86f40dbf5fdda6a6e6a1d9b4b7ace8323d2fd7882',
  'normalize/unfurl-only.json': 'ffef0f63ad57f2f82ced4bd3394e96b6e6bbd798ac22827206d5783734c60cc3',
  'rendered-reply.json': 'd571033648b1b12fd02a83edcb5654d382e94dcc30d01c49f75d2407265f325f',
  'skeleton.json': 'e58eab66f53be3333a023408ffe35eb183e5114aeb1804467077fdd72a98e232',
  'slack-text-tokens.json': 'dcaeadbb37fe9649f9b104bd98a7a458859c8ab1e5ea0be669a049697ffcd00f',
}

async function contractFixture(relativePath) {
  return JSON.parse(await readFile(join(contractFixtures, relativePath), 'utf8'))
}

test('the channel-contract-v2 copies are byte-identical to the Desktop source recorded in their README', async () => {
  // Edited copies would silently move this adapter off the contract Core checks against.
  const readme = await readFile(join(contractFixtures, 'README.md'), 'utf8')
  assert.match(readme, /커밋 `d162cbd4aafc0d34f200bb5d4420304fa2d75852`/)
  const recorded = new Map([...readme.matchAll(/^\| `([^`]+)` \| `([0-9a-f]{64})` \|$/gm)].map(match => [match[1], match[2]]))
  // Pinned here as well, so a copy edited together with its README row still fails until the source moves.
  assert.deepEqual(Object.fromEntries(recorded), CONTRACT_FIXTURE_SHA256)
  const files = [
    ...(await readdir(contractFixtures)).filter(name => name.endsWith('.json')),
    ...(await readdir(join(contractFixtures, 'normalize'))).map(name => `normalize/${name}`),
  ].sort()
  assert.deepEqual([...recorded.keys()].sort(), files)
  for (const file of files) {
    const digest = createHash('sha256').update(await readFile(join(contractFixtures, file))).digest('hex')
    assert.equal(digest, recorded.get(file), file)
  }
})

// ---- channel.normalizeMessages (contracts §5.2) ------------------------------------------------

const NORMALIZE_FIXTURES = ['forward', 'quote', 'same-text-blocks', 'table', 'unfurl-only']

test('Slack tokens in Slack-authored text read exactly as Core renders them', async () => {
  const { renderSlackTextTokens } = await bundleModule('src/slackTextTokens.ts')
  const { vectors } = await contractFixture('slack-text-tokens.json')
  assert.ok(vectors.length > 0)
  for (const vector of vectors) {
    assert.equal(renderSlackTextTokens(vector.text, vector.userLabels), vector.expected, vector.id)
  }
})

test('Slack token readings the shared vectors leave open match Desktop channelSlackTextTokens', async () => {
  // Desktop d162cbd4aa src/domain/channelSlackTextTokens.ts: a date fallback is a label too (control
  // characters out, 64 UTF-16 units), a link url has no whitespace, and an empty link label stays a label.
  const { renderSlackTextTokens } = await bundleModule('src/slackTextTokens.ts')
  assert.equal(renderSlackTextTokens(`<!date^1793000000^{date}|${'가'.repeat(70)}\u0007>`, {}), '가'.repeat(64))
  assert.equal(renderSlackTextTokens('<http://a b|문서> <http://a b>', {}), '<http://a b|문서> <http://a b>')
  assert.equal(renderSlackTextTokens('<https://x|>', {}), ' (https://x)')
})

test('a long date fallback cannot push a later quote out of the budget', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const request = normalizeRequest([['회의', { blocks: [
    { type: 'section', text: { type: 'mrkdwn', text: `<!date^1793000000^{date}|${'a'.repeat(2100)}>` } },
    { type: 'rich_text', elements: [{ type: 'rich_text_quote', elements: [{ type: 'text', text: '운영 DB 삭제 금지' }] }] },
  ] }]])
  assert.deepEqual(normalizeSlackMessages(request).items[0], {
    itemRef: 'i0',
    additions: [{ source: 'blocks', text: 'a'.repeat(64) }, { source: 'quote', text: '[인용] 운영 DB 삭제 금지' }],
    truncated: false,
  })
})

test('normalizeSlackMessages produces each shared I02 fixture result exactly', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  for (const name of NORMALIZE_FIXTURES) {
    const fixture = await contractFixture(`normalize/${name}.json`)
    assert.deepEqual(normalizeSlackMessages(fixture.request), fixture.expectedResult, fixture.id)
  }
})

test('the test host fake history builds the same requests as the Desktop fixtures', async () => {
  // Cross-check promised in PR #62: the test host's Core fake and Desktop's fixtures agree on shape.
  for (const name of NORMALIZE_FIXTURES) {
    const { request } = await contractFixture(`normalize/${name}.json`)
    const rebuilt = fakeSlackHistory({
      channelId: request.channelId, connectionId: request.connectionId, connectionRevision: request.connectionRevision,
      requestId: request.requestId, purpose: request.purpose, userLabels: request.userLabels,
      messages: request.items.map(item => ({
        primaryText: item.primaryText, projection: item.projection, root: item.maxAdditionsBytes === 6000,
      })),
    })
    assert.deepEqual(rebuilt, request, name)
  }
})

test('channel API 2 format requests: verbatim reads as v1, rendered returns mrkdwn chunks Core accepts (O01, T33)', async () => {
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  const packed = await packedSlack()
  try {
    const host = createTestHost('buzzni.slack')
    await host.activate(packed.extension)
    const base = {
      channelId: 'buzzni.slack.bot', connectionId: 'c1', provider: 'slack', connectionRevision: 1,
      requestId: 'r1', kind: 'final', text: '완료 & <b>', maxChunkUtf16Units: 3000, maxChunks: 64,
    }
    const v1 = await host.formatChannelReply({ ...base, apiVersion: 1 })
    assert.deepEqual(v1, { chunks: ['완료 & <b>'] })
    assert.deepEqual(await host.formatChannelReply({ ...base, apiVersion: 2, mode: 'verbatim', dialect: 'slack-mrkdwn' }), v1)
    // R11: a short answer is rendered as well, a status line too.
    for (const [kind, text] of [['final', '**완료** & <b> `<!here>`'], ['status', '_빌드 중_ (2/3)']]) {
      const result = await host.formatChannelReply({ ...base, kind, text, apiVersion: 2, mode: 'rendered', dialect: 'slack-mrkdwn' })
      assert.deepEqual(Object.keys(result), ['rendered'])
      const verdict = verifyRenderedReply(text, result, { maxChunkUtf16Units: 3000, maxChunks: 64 })
      assert.ok(verdict.ok, `${kind}: rule ${verdict.rule}`)
    }
    assert.deepEqual(
      (await host.formatChannelReply({ ...base, text: '**완료** & <b>', apiVersion: 2, mode: 'rendered', dialect: 'slack-mrkdwn' })).rendered,
      [{ text: '*완료* &amp; &lt;b&gt;', sourceStart: 0, sourceEnd: 12 }],
    )
    // What only the plain path can send is refused, so Core falls back to it (§6.4).
    await assert.rejects(
      host.formatChannelReply({ ...base, text: '벨\u0007', apiVersion: 2, mode: 'rendered', dialect: 'slack-mrkdwn' }),
      /control character/,
    )
    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('the packaged extension registers its normalizer and passes the test host contract check', async () => {
  const packed = await packedSlack()
  try {
    const host = createTestHost('buzzni.slack')
    await host.activate(packed.extension)
    for (const name of NORMALIZE_FIXTURES) {
      const fixture = await contractFixture(`normalize/${name}.json`)
      assert.deepEqual(
        await host.normalizeChannelMessages({ ...fixture.request, channelId: 'buzzni.slack.bot' }),
        fixture.expectedResult,
        fixture.id,
      )
    }
    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

function normalizeRequest(items, overrides = {}) {
  return fakeSlackHistory({
    channelId: 'buzzni.slack.bot', userLabels: { U1: 'kim' },
    messages: items.map(([primaryText, projection, root = false]) => ({ primaryText, projection, root })),
    ...overrides,
  })
}

function utf8(text) { return new TextEncoder().encode(text).length }

test('normalizeSlackMessages writes blocks, lists, code, attachments and files as readable additions', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const request = normalizeRequest([
    ['배포 공지', {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '배포 공지' } },
        { type: 'section', text: { type: 'mrkdwn', text: '담당 <@U1> &amp; <#C1|ops>' }, fields: [{ type: 'mrkdwn', text: '*환경* prod' }] },
        { type: 'context', elements: [{ type: 'mrkdwn', text: '자동 알림' }, { type: 'plain_text', text: 'v2' }] },
        { type: 'rich_text', elements: [
          { type: 'rich_text_list', style: 'ordered', elements: [
            { type: 'rich_text_section', elements: [{ type: 'text', text: '빌드' }] },
            { type: 'rich_text_section', elements: [{ type: 'link', url: 'https://ci.example/1', text: '로그' }, { type: 'broadcast', range: 'here' }] },
          ] },
          { type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'npm run deploy\nexit 0' }] },
          { type: 'rich_text_section', elements: [{ type: 'usergroup', usergroup_id: 'S1' }, { type: 'text', text: ' ' }, { type: 'emoji', name: 'tada' }, { type: 'channel', channel_id: 'C9' }] },
        ] },
      ],
      attachments: [{ pretext: '알림', title: '빌드 결과', text: '성공 <!channel>' }],
      files: [{ name: 'log.txt', filetype: 'text', size: 1536 }, { title: '스크린샷', mimetype: 'image/png' }, {}],
    }, true],
  ])
  assert.deepEqual(normalizeSlackMessages(request).items, [{
    itemRef: 'i0',
    truncated: false,
    additions: [
      // The header repeats the primary text, so it is left out.
      { source: 'blocks', text: '담당 @kim & #ops\n*환경* prod' },
      { source: 'blocks', text: '자동 알림 v2' },
      { source: 'blocks', text: '1. 빌드\n2. 로그 (https://ci.example/1)@here' },
      { source: 'blocks', text: 'npm run deploy\nexit 0' },
      { source: 'blocks', text: '@usergroup :tada:#C9' },
      { source: 'blocks', text: '알림\n빌드 결과\n성공 @channel' },
      { source: 'files', text: '[첨부: log.txt (text, 1.5 KB)]' },
      { source: 'files', text: '[첨부: 스크린샷 (image/png)]' },
      { source: 'files', text: '[첨부: 파일]' },
    ],
  }])
})

test('normalizeSlackMessages leaves out lines Core would drop as duplicates', async () => {
  // Same line rule as Core (§5.2 rule 3): whole lines only, compared with whitespace folded.
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const request = normalizeRequest([['회의는  3시\nA', { blocks: [
    { type: 'section', text: { type: 'mrkdwn', text: '회의는 3시\nBACKUP' } },
    { type: 'section', text: { type: 'mrkdwn', text: ' A ' } },
    { type: 'section', text: { type: 'mrkdwn', text: 'BACKUP\n회의는 3시 이후 공지' } },
    { type: 'rich_text', elements: [{ type: 'rich_text_preformatted', elements: [{ type: 'text', text: 'if (a) {\n  }\n}' }] }] },
  ] }]])
  assert.deepEqual(normalizeSlackMessages(request).items[0].additions, [
    { source: 'blocks', text: 'BACKUP' },
    { source: 'blocks', text: '회의는 3시 이후 공지' },
    // Lines repeated inside one addition stay: Core only drops lines seen earlier.
    { source: 'blocks', text: 'if (a) {\n  }\n}' },
  ])
})

test('normalizeSlackMessages keeps every result within budget and free of characters Core refuses', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const long = '가'.repeat(1000)
  const request = normalizeRequest([
    ['원글', { blocks: [{ type: 'section', text: { type: 'plain_text', text: long } }, { type: 'section', text: { type: 'plain_text', text: '뒤 블록' } }] }],
    ['깨진 글', { blocks: [{ type: 'section', text: { type: 'plain_text', text: 'a\u0000b\uD800c\u0007d\te' } }] }],
  ])
  const [reply, broken] = normalizeSlackMessages(request).items
  assert.equal(reply.truncated, true)
  assert.equal(reply.additions.length, 1)
  assert.ok(reply.additions[0].text.endsWith('…(잘림)'))
  assert.ok(utf8(reply.additions.map(addition => addition.text).join('')) <= 2000)
  assert.deepEqual(broken.additions, [{ source: 'blocks', text: 'ab�cd\te' }])
  assert.equal(broken.truncated, false)

  // A surrogate pair is never cut in half at the budget edge.
  const emoji = normalizeSlackMessages(normalizeRequest([['x', { blocks: [{ type: 'section', text: { type: 'plain_text', text: '😀'.repeat(600) } }] }]]))
  const text = emoji.items[0].additions[0].text
  assert.ok(utf8(text) <= 2000)
  assert.doesNotMatch(text.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ''), /[\uD800-\uDFFF]/)
})

test('normalizeSlackMessages survives ids and tokens that name Object.prototype properties', async () => {
  // An inherited `userLabels.constructor` is a function, not a label; one such item must not lose them all.
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const { renderSlackTextTokens } = await bundleModule('src/slackTextTokens.ts')
  assert.equal(renderSlackTextTokens('<toString> <!constructor> <@Uconstructor>', {}), '<toString> <!constructor> <@Uconstructor>')
  const request = normalizeRequest([['x', { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
    { type: 'user', user_id: 'constructor' }, { type: 'user', user_id: '__proto__' },
  ] }] }] }]], { userLabels: {} })
  assert.deepEqual(normalizeSlackMessages(request).items[0].additions, [{ source: 'blocks', text: '@constructor@__proto__' }])
})

test('normalizeSlackMessages keeps nested quotes, forwarded text without usable blocks, and long file names', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const longName = `${'a'.repeat(70)}`
  const request = normalizeRequest([['x', {
    blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [
      { type: 'text', text: '설명' }, { type: 'rich_text_quote', elements: [{ type: 'text', text: '삭제 금지' }] },
    ] }] }],
    attachments: [
      { is_share: true, text: '원문 중요 내용', message_blocks: [{ message: { blocks: [] } }] },
      { is_share: true, text: '두 번째 원문', message_blocks: [{ message: { blocks: [{ type: 'section' }] } }] },
    ],
    files: [{ name: `${longName}-1.txt`, filetype: 'text', size: 1 }, { name: `${longName}-2.txt`, filetype: 'text', size: 1 }],
  }, true]])
  assert.deepEqual(normalizeSlackMessages(request).items[0].additions, [
    { source: 'blocks', text: '설명' },
    { source: 'quote', text: '[인용] 삭제 금지' },
    { source: 'forward', text: '[전달된 글] 원문 중요 내용' },
    { source: 'forward', text: '[전달된 글] 두 번째 원문' },
    { source: 'files', text: `[첨부: ${longName}-1.txt (text, 1 B)]` },
    { source: 'files', text: `[첨부: ${longName}-2.txt (text, 1 B)]` },
  ])
})

test('normalizeSlackMessages keeps quotes where they stand, under lists too, so the budget cuts the end first', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const quote = (text) => ({ type: 'rich_text_quote', elements: [{ type: 'text', text }] })
  const ordered = normalizeSlackMessages(normalizeRequest([['x', { blocks: [{ type: 'rich_text', elements: [
    { type: 'rich_text_section', elements: [{ type: 'text', text: '앞' }, quote('가운데 인용'), { type: 'text', text: '뒤' }] },
    { type: 'rich_text_list', style: 'bullet', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: '항목' }] }, quote('삭제 금지')] },
  ] }] }]]))
  assert.deepEqual(ordered.items[0].additions, [
    { source: 'blocks', text: '앞' },
    { source: 'quote', text: '[인용] 가운데 인용' },
    { source: 'blocks', text: '뒤' },
    { source: 'blocks', text: '- 항목' },
    { source: 'quote', text: '[인용] 삭제 금지' },
  ])
  const budgeted = normalizeSlackMessages(normalizeRequest([['x', { blocks: [{ type: 'rich_text', elements: [
    { type: 'rich_text_section', elements: [quote('운영 DB 삭제 금지'), { type: 'text', text: 'a'.repeat(2500) }] },
  ] }] }]]))
  assert.equal(budgeted.items[0].truncated, true)
  assert.deepEqual(budgeted.items[0].additions[0], { source: 'quote', text: '[인용] 운영 DB 삭제 금지' })
})

test('normalizeSlackMessages reads forwards and unfurls without their author or source link', async () => {
  const { normalizeSlackMessages } = await bundleModule('src/normalize.ts')
  const request = normalizeRequest([['링크', { attachments: [
    { is_share: true, author_name: 'Park', from_url: 'https://a.slack.com/archives/C2/p1', text: '본문만 <@U1>' },
    { is_msg_unfurl: true, original_url: 'https://a.slack.com/archives/C3/p2', text: '다른 채널 글' },
    { original_url: 'https://news.example/b' },
  ] }]])
  assert.deepEqual(normalizeSlackMessages(request).items[0].additions, [
    { source: 'forward', text: '[전달된 글] 본문만 @kim' },
    { source: 'unfurl', text: '[링크 미리보기] 다른 채널 글 — https://a.slack.com/archives/C3/p2' },
    { source: 'unfurl', text: '[링크 미리보기] https://news.example/b' },
  ])
})

// ---- command parsing / mention & mrkdwn normalization (white-box: pure functions) -------------

test('Slack command text maps to the exact sessions.control operations Core parses', async () => {
  const { parseSlackCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(parseSlackCommand('/projects'), { operation: 'projects' })
  assert.deepEqual(parseSlackCommand('/settings --agent codex --model gpt-6.1-sol --effort low'), {
    operation: 'configure',
    text: '/settings --agent codex --model gpt-6.1-sol --effort low',
  })
  assert.deepEqual(parseSlackCommand('/status'), { operation: 'status' })
  assert.deepEqual(parseSlackCommand('/stop'), { operation: 'stop' })
  assert.deepEqual(parseSlackCommand('/new build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseSlackCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseSlackCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseSlackCommand('/select'), { operation: 'prompt', text: '/select' })
  assert.deepEqual(parseSlackCommand('/unknowncmd foo'), { operation: 'prompt', text: '/unknowncmd foo' })
  assert.deepEqual(parseSlackCommand('그냥 대화 내용입니다'), { operation: 'prompt', text: '그냥 대화 내용입니다' })
})

test('/use and /start are recognized as Core\'s own aliases for select and new (classifyChannelIntent COMMAND_INTENTS)', async () => {
  const { parseSlackCommand } = await bundleModule('src/commands.ts')
  assert.deepEqual(parseSlackCommand('/start build a landing page'), { operation: 'create', text: 'build a landing page' })
  assert.deepEqual(parseSlackCommand('/use sess-42'), { operation: 'select', sessionRef: 'sess-42' })
  assert.deepEqual(parseSlackCommand('/start'), { operation: 'create' })
  // Empty /use falls back to prompt, same rule as empty /select.
  assert.deepEqual(parseSlackCommand('/use'), { operation: 'prompt', text: '/use' })
  // Existing canonical words are unaffected by adding the aliases.
  assert.deepEqual(parseSlackCommand('/new'), { operation: 'create' })
  assert.deepEqual(parseSlackCommand('/select sess-42'), { operation: 'select', sessionRef: 'sess-42' })
})

test('a mention naming someone else is never treated as a command trigger (no unverified stripping)', async () => {
  const { parseSlackCommand } = await bundleModule('src/commands.ts')
  // Without a Core-verified bot identity, this adapter cannot tell "the bot was @mentioned" from
  // "someone else was mentioned" — so a leading mention must never be stripped before matching the
  // slash-command pattern. Stripping it here would have let a message that only *mentions* another
  // user execute `/stop` as if the sender had typed it bare.
  assert.deepEqual(parseSlackCommand('<@U_OTHER> /stop'), { operation: 'prompt', text: '@U_OTHER /stop' })
  assert.deepEqual(parseSlackCommand('<@U_OTHER|jane> /new landing page'), { operation: 'prompt', text: '@jane /new landing page' })
  assert.deepEqual(parseSlackCommand('<@U_OTHER> hello there'), { operation: 'prompt', text: '@U_OTHER hello there' })
})

test('Slack mrkdwn entities resolve to plain text in prompt content', async () => {
  const { normalizeSlackText } = await bundleModule('src/commands.ts')
  assert.equal(normalizeSlackText('a &amp; b &lt;c&gt;'), 'a & b <c>')
  assert.equal(normalizeSlackText('ping <@U0123|jane>'), 'ping @jane')
  assert.equal(normalizeSlackText('ping <@U0123>'), 'ping @U0123')
  assert.equal(normalizeSlackText('see <#C0123|general>'), 'see #general')
  assert.equal(normalizeSlackText('link <https://example.com|docs>'), 'link docs (https://example.com)')
  assert.equal(normalizeSlackText('link <https://example.com>'), 'link https://example.com')
  assert.equal(normalizeSlackText('<!here> team'), '@here team')
})

test('unrecognized bracketed content — plain text or code, not Slack markup — is left completely untouched', async () => {
  const { normalizeSlackText } = await bundleModule('src/commands.ts')
  assert.equal(normalizeSlackText('use <div>hello</div> tags'), 'use <div>hello</div> tags')
  assert.equal(normalizeSlackText('a generic <placeholder> value'), 'a generic <placeholder> value')
  assert.equal(normalizeSlackText('<not a link, just brackets>'), '<not a link, just brackets>')
  assert.equal(normalizeSlackText('code: <script>alert(1)</script>'), 'code: <script>alert(1)</script>')
})

// ---- backoff (white-box: pure function) --------------------------------------------------------

test('receive backoff resets on events, stays short while idle, and backs off further only on failure', async () => {
  const { nextSlackReceiveDelayMs, SLACK_RECEIVE_BASE_MS, SLACK_RECEIVE_IDLE_MAX_MS, SLACK_RECEIVE_MAX_MS } = await bundleModule('src/backoff.ts')
  let idle = SLACK_RECEIVE_BASE_MS
  for (let i = 0; i < 10; i++) idle = nextSlackReceiveDelayMs(idle, false)
  assert.equal(idle, SLACK_RECEIVE_IDLE_MAX_MS)
  assert.ok(SLACK_RECEIVE_IDLE_MAX_MS <= 3_000)
  let failing = SLACK_RECEIVE_BASE_MS
  for (let i = 0; i < 10; i++) failing = nextSlackReceiveDelayMs(failing, false, true)
  assert.equal(failing, SLACK_RECEIVE_MAX_MS)
  // An empty window after a failure is idle again, not still failing.
  assert.equal(nextSlackReceiveDelayMs(failing, false), SLACK_RECEIVE_IDLE_MAX_MS)
  assert.equal(nextSlackReceiveDelayMs(failing, true), SLACK_RECEIVE_BASE_MS)
})

// Core admits messages in real time but has no "new work is waiting" push, so the time between a
// message arriving and this adapter dispatching it is the idle poll interval. It was 30s, and a
// follow-up sent after a short pause sat in Core's queue for up to that long.
test('an idle connection dispatches a new message within 3s, however long it has been quiet', async (t) => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const waiting = []
  const dispatched = []
  let receives = 0
  const invokeCapability = async (permission, action, args) => {
    if (permission === 'channels.receive') {
      receives += 1
      return { events: waiting.splice(0), cursor: waiting.length === 0 ? null : '1' }
    }
    if (permission === 'sessions.control') dispatched.push(args.eventHandle)
    return {}
  }
  const runtime = createSlackIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)) }

  for (let i = 0; i < 300; i++) { t.mock.timers.tick(1_000); await settle() }
  // Arrive just after a poll: the worst case, where the whole idle interval is waited out.
  const before = receives
  while (receives === before) { t.mock.timers.tick(1_000); await settle() }
  waiting.push(envelope({ eventHandle: 'late', semanticMessageId: 'late-msg' }))
  t.mock.timers.tick(3_000)
  await settle()

  assert.deepEqual(dispatched, ['late'])
  await runtime.stop()
})

// ---- Core's rendered-reply check, ported (contracts §6.3) ---------------------------------------
// The renderer is held to the check Core runs on its result. This port must give Core's verdict on
// every shared case, or a passing renderer test would say nothing about what Core accepts.

test('the ported skeleton gives every shared skeleton vector', async () => {
  const { renderedSkeleton } = await bundleModule('src/renderedReplyCheck.ts')
  for (const { id, dialect, input, expected } of (await contractFixture('skeleton.json')).vectors) {
    assert.equal(renderedSkeleton(dialect, input), expected, id)
  }
})

test('the ported verifier gives Core\'s verdict on every shared rendered-reply case', async () => {
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  for (const testCase of (await contractFixture('rendered-reply.json')).cases) {
    const verdict = verifyRenderedReply(testCase.source, testCase.result, testCase.limits)
    if (testCase.expected.verdict === 'accept') {
      assert.deepEqual(verdict, { ok: true, chunks: testCase.result.rendered.map(chunk => chunk.text) }, testCase.id)
    } else {
      assert.equal(verdict.ok, false, testCase.id)
      assert.ok(testCase.expected.failedRules.includes(verdict.rule), `${testCase.id}: rule ${verdict.rule}`)
    }
  }
})

test('the ported verifier refuses a source holding NUL, as Core does', async () => {
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  assert.deepEqual(
    verifyRenderedReply('a\u0000b', { rendered: [{ text: 'ab', sourceStart: 0, sourceEnd: 3 }] }, { maxChunkUtf16Units: 3000, maxChunks: 64 }),
    { ok: false, rule: 3 },
  )
})

test('the ported verifier stays linear on adversarial link text', async () => {
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  for (const source of ['['.repeat(65_536), '![a]('.repeat(10_000), '[a]'.repeat(20_000)]) {
    const started = performance.now()
    const verdict = verifyRenderedReply(source, { rendered: [{ text: 'x', sourceStart: 0, sourceEnd: source.length }] }, { maxChunkUtf16Units: 3000, maxChunks: 64 })
    assert.equal(verdict.ok, false)
    assert.ok(performance.now() - started < 1_000)
  }
})

// ---- Markdown → Slack mrkdwn renderer (contracts §6.1–§6.3, scenario O01) ---------------------

const RENDER_LIMITS = { maxChunkUtf16Units: 3000, maxChunks: 64 }

/** Renders `source` and holds the result to the ported Core check; returns the chunks. */
async function renderedAndAccepted(source, limits = RENDER_LIMITS) {
  const { renderSlackMarkdown } = await bundleModule('src/render.ts')
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  const rendered = renderSlackMarkdown(source, limits)
  const verdict = verifyRenderedReply(source, { rendered }, limits)
  assert.ok(verdict.ok, `refused by rule ${verdict.rule}: ${JSON.stringify(rendered).slice(0, 400)}`)
  return rendered
}

function fencesBalanced(text) {
  const lines = text.split('\n')
  return lines.filter(line => line.startsWith('```')).length % 2 === 0 && lines.every(line => !line.includes('```') || line === '```')
}

test('every shared fixture answer renders to a result Core accepts, except one that holds a control character', async () => {
  const { renderSlackMarkdown, SlackRenderUnsupportedError } = await bundleModule('src/render.ts')
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  for (const testCase of (await contractFixture('rendered-reply.json')).cases) {
    if (/[\u0000-\u0008\u000b-\u001f]/.test(testCase.source)) {
      // Rule 2 refuses the bell in any chunk and rule 3 refuses dropping it: only the plain path can send it.
      assert.throws(() => renderSlackMarkdown(testCase.source, testCase.limits), SlackRenderUnsupportedError, testCase.id)
      continue
    }
    const rendered = renderSlackMarkdown(testCase.source, testCase.limits)
    const verdict = verifyRenderedReply(testCase.source, { rendered }, testCase.limits)
    assert.ok(verdict.ok, `${testCase.id}: rule ${verdict.rule}`)
  }
})

test('O01 (a): a short Markdown answer is rendered too, as Slack bold, bullets and a labeled link', async () => {
  const source = '# 제목\n**굵게** 설명과 [링크](https://x.example)\n- 목록 하나\n- 목록 둘'
  assert.deepEqual(await renderedAndAccepted(source), [{
    text: '*제목*\n*굵게* 설명과 <https://x.example|링크>\n• 목록 하나\n• 목록 둘', sourceStart: 0, sourceEnd: source.length,
  }])
})

test('O01 (b): a 40-row table becomes one aligned code block with balanced fences', async () => {
  const rows = Array.from({ length: 40 }, (_, i) => `| api-${i + 1} | ${i % 7 === 0 ? '점검 중' : '정상'} |`)
  const source = ['| 서버 | 상태 |', '|---|---|', ...rows].join('\n')
  const [chunk, ...rest] = await renderedAndAccepted(source)
  assert.equal(rest.length, 0)
  assert.ok(fencesBalanced(chunk.text))
  const lines = chunk.text.split('\n')
  assert.deepEqual([lines[0], lines.at(-1)], ['```', '```'])
  assert.equal(lines.length, 2 + 42)
  assert.equal(lines[1], '| 서버   | 상태    |')
  assert.equal(lines[3], '| api-1  | 점검 중 |')
  assert.equal(lines[4], '| api-2  | 정상    |')
})

test('O01 (c): a 9,000-character code block goes out as 3–4 chunks that each open and close a fence, code only escaped', async () => {
  const testCase = (await contractFixture('rendered-reply.json')).cases.find(c => c.id === 'o01-long-code-escaped-chunks')
  const chunks = await renderedAndAccepted(testCase.source)
  assert.ok(chunks.length >= 3 && chunks.length <= 4, `${chunks.length} chunks`)
  for (const { text } of chunks) {
    assert.ok(text.length <= 3000)
    assert.ok(fencesBalanced(text))
    assert.doesNotMatch(text, /<[!@#]/)
  }
  const shown = chunks.map(chunk => chunk.text).join('\n')
  assert.match(shown, /print\("&lt;@U1&gt;"\)/)
  assert.match(shown, /if a &amp;&amp; b: x -&gt; y/)
  assert.match(shown, /send\("&lt;!channel&gt;"\)/)
})

test('O01 (d): a joined emoji on the 3,000 boundary is never cut, and a long paragraph is split between words', async () => {
  const emoji = (await contractFixture('rendered-reply.json')).cases.find(c => c.id === 'o01-emoji-at-3000-boundary')
  const chunks = await renderedAndAccepted(emoji.source)
  assert.ok(chunks.some(chunk => chunk.text.startsWith('👨‍👩‍👧')))
  const sentence = '배포 전에 [체크리스트](https://wiki.example/release) 를 확인하고 `npm test` 를 실행합니다. '
  const paragraph = sentence.repeat(160)
  for (const chunk of await renderedAndAccepted(paragraph)) {
    assert.ok(chunk.text.length <= 3000)
    // Cuts land after a space, never inside the link or the code span.
    assert.ok(chunk.sourceEnd === paragraph.length || paragraph[chunk.sourceEnd - 1] === ' ', String(chunk.sourceEnd))
    assert.doesNotMatch(chunk.text, /<https:\/\/wiki\.example\/release\|체크리스트>[^ ]|\[체크/)
  }
})

test('Slack special tokens and HTML in the answer are escaped, outside code as well as inside', async () => {
  const [chunk] = await renderedAndAccepted('공지 <!here> 담당 <@U2> 채널 <#C1> <b>굵게</b> a && b\n`<!channel>` 는 쓰지 마세요')
  assert.equal(chunk.text, '공지 &lt;!here&gt; 담당 &lt;@U2&gt; 채널 &lt;#C1&gt; &lt;b&gt;굵게&lt;/b&gt; a &amp;&amp; b\n`&lt;!channel&gt;` 는 쓰지 마세요')
})

test('inline Markdown reads as Slack mrkdwn: emphasis, strike, code, quotes, images and links Slack cannot open', async () => {
  const source = [
    '## 요약',
    '이번 변경은 **중요**하고 *조심*해야 하며 ~~예전 방식~~ 은 버립니다. `rm -rf` 는 금지.',
    '> 인용한 문장',
    '>> 중첩 인용',
    '![구성도](https://img.example/a.png) 와 [내부](ftp://files.example/x) 참고',
    '[https://a.example](https://b.example) 는 다른 주소입니다',
    '---',
    '1. 첫째',
    '2. 둘째',
    '   - 하위 항목',
    '   * 별 하위',
  ].join('\n')
  const [chunk] = await renderedAndAccepted(source)
  assert.deepEqual(chunk.text.split('\n'), [
    '*요약*',
    '이번 변경은 *중요*하고 _조심_해야 하며 ~예전 방식~ 은 버립니다. `rm -rf` 는 금지.',
    '> 인용한 문장',
    '> 중첩 인용',
    '<https://img.example/a.png|구성도> 와 내부 ftp://files.example/x 참고',
    'https://a.example <https://b.example> 는 다른 주소입니다',
    '---',
    '1. 첫째',
    '2. 둘째',
    '   - 하위 항목',
    '   * 별 하위',
  ])
})

test('code blocks keep their bytes (escaped), lose only the language tag, and a fence nested in a list item is a code block too', async () => {
  const source = [
    '설치:',
    '```bash',
    'npm i && npm test > out.txt',
    '```',
    '1. 빌드',
    '   ```sh',
    '   make all',
    '   ```',
  ].join('\n')
  const [chunk] = await renderedAndAccepted(source)
  assert.deepEqual(chunk.text.split('\n'), [
    '설치:', '```', 'npm i &amp;&amp; npm test &gt; out.txt', '```', '1. 빌드', '_sh_', '```', 'make all', '```',
  ])
})

test('a nested fence showing the same code as a later code block does not take that block\'s place in Core\'s check', async () => {
  // Core pairs each source code block with the first rendered block of the same content; the nested
  // one is not a source code block, so the answer is written without it as a block.
  const source = '1. 테스트\n   ```\n   npm test\n   ```\n다시 한 번:\n```\nnpm test\n```'
  const [chunk] = await renderedAndAccepted(source)
  assert.equal(chunk.text.split('\n').filter(line => line === '```').length, 2)
})

test('a table honors its column alignment and keeps cells past the header', async () => {
  const source = '| 항목 | 수량 | 비고 |\n|:--|--:|:-:|\n| 사과 | 3 | 빨강 |\n| 배 | 12 | 노랑 | 추가 |'
  const [chunk] = await renderedAndAccepted(source)
  assert.deepEqual(chunk.text.split('\n'), [
    '```',
    '| 항목 | 수량 | 비고 |      |',
    '|------|------|------|------|',
    '| 사과 |    3 | 빨강 |      |',
    '| 배   |   12 | 노랑 | 추가 |',
    '```',
  ])
})

test('the renderer refuses what only the plain path can send', async () => {
  const { renderSlackMarkdown, SlackRenderUnsupportedError } = await bundleModule('src/render.ts')
  for (const source of [
    '',
    'a\u0000b',
    '```\nconst fence = "``` inside"\n```',
    '```\r\nwindows line\r\n```',
    '\ud800 lone',
  ]) {
    assert.throws(() => renderSlackMarkdown(source, RENDER_LIMITS), SlackRenderUnsupportedError, JSON.stringify(source))
  }
  assert.throws(() => renderSlackMarkdown('가 '.repeat(100), { maxChunkUtf16Units: 10, maxChunks: 3 }), SlackRenderUnsupportedError)
})

// Core waits 3 s for a rendering (§6.4); the approved text can be 64 KiB on one line.
test('rendering stays fast on adversarial 64 KiB answers', async () => {
  const { renderSlackMarkdown, SlackRenderUnsupportedError } = await bundleModule('src/render.ts')
  for (const source of ['['.repeat(65_536), '**a '.repeat(16_000), '*a '.repeat(20_000), '\\*'.repeat(30_000), '[a](https://x) '.repeat(4_000), 'a\n'.repeat(30_000)]) {
    const started = performance.now()
    try { renderSlackMarkdown(source, RENDER_LIMITS) } catch (error) { if (!(error instanceof SlackRenderUnsupportedError)) throw error }
    assert.ok(performance.now() - started < 2_000, `${source.slice(0, 8)}: ${performance.now() - started}ms`)
  }
})

test('CRLF prose and lines Markdown escapes still render to a result Core accepts', async () => {
  for (const source of [
    '첫 줄\r\n둘째 줄\r\n',
    '\\# 제목 아님\n\\- 목록 아님\n\\> 인용 아님\n\\*별\\* 그대로 C:\\\\Users',
    '| 열 |\n|---|\n| a \\| b |',
    '- [ ] 할 일\n- [x] 끝',
    '***\n___\n* * *',
    '\n\n앞뒤 빈 줄\n\n',
  ]) await renderedAndAccepted(source)
})

// T34: contracts §6.3 would be too strict if most answers fell back to plain text; under 95% the
// contract needs adjusting (Desktop specs/slack-bot-improvements plan, risks).
test('at least 95 of 100 fake answers render to a result Core accepts, and every miss is a refusal, not a bad result', async (t) => {
  const { renderSlackMarkdown, SlackRenderUnsupportedError } = await bundleModule('src/render.ts')
  const { verifyRenderedReply } = await bundleModule('src/renderedReplyCheck.ts')
  const { fakeAnswers } = await import(pathToFileURL(join(packageRoot, 'test/renderSamples.mjs')).href)
  const answers = fakeAnswers()
  assert.equal(answers.length, 100)
  assert.ok(answers.filter(answer => answer.length > 3000).length >= 10)
  const missed = []
  let accepted = 0
  for (const [index, answer] of answers.entries()) {
    try {
      const verdict = verifyRenderedReply(answer, { rendered: renderSlackMarkdown(answer, RENDER_LIMITS) }, RENDER_LIMITS)
      assert.ok(verdict.ok, `answer ${index} rendered but Core refuses it (rule ${verdict.rule})`)
      accepted += 1
    } catch (error) {
      if (!(error instanceof SlackRenderUnsupportedError)) throw error
      missed.push(`${index}: ${error.message}`)
    }
  }
  t.diagnostic(`rendered and accepted: ${accepted}/100; sent as plain text: ${missed.join('; ') || 'none'}`)
  assert.ok(accepted >= 95, `${accepted}/100`)
})

// ---- formatter (white-box: pure function, also exercised through the real formatter registration) --

test('formatter concatenates back to the exact input for Korean and emoji text', async () => {
  const { formatSlackReply } = await bundleModule('src/reply.ts')
  const text = '안녕하세요! 🎉🚀 결과가 도착했습니다. '.repeat(30) + '😀'.repeat(5)
  const { chunks } = formatSlackReply({ text, maxChunkUtf16Units: 40, maxChunks: 200 })
  assert.equal(chunks.join(''), text)
  for (const chunk of chunks) assert.ok(chunk.length <= 40 + 1)
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const code = chunk.charCodeAt(i)
      if (code >= 0xd800 && code <= 0xdbff) assert.ok(i + 1 < chunk.length && chunk.charCodeAt(i + 1) >= 0xdc00 && chunk.charCodeAt(i + 1) <= 0xdfff)
      if (code >= 0xdc00 && code <= 0xdfff) assert.ok(i > 0 && chunk.charCodeAt(i - 1) >= 0xd800 && chunk.charCodeAt(i - 1) <= 0xdbff)
    }
  }
})

test('formatter never splits a surrogate pair even at a 1-unit cap', async () => {
  const { formatSlackReply } = await bundleModule('src/reply.ts')
  const { chunks } = formatSlackReply({ text: '😀😀', maxChunkUtf16Units: 1, maxChunks: 10 })
  assert.deepEqual(chunks, ['😀', '😀'])
  assert.equal(chunks.join(''), '😀😀')
})

test('formatter returns no chunks for empty text and adds no markers of its own', async () => {
  const { formatSlackReply } = await bundleModule('src/reply.ts')
  assert.deepEqual(formatSlackReply({ text: '', maxChunkUtf16Units: 10, maxChunks: 5 }).chunks, [])
  const { chunks } = formatSlackReply({ text: 'exact-forty-char-one-chunk-of-text-here', maxChunkUtf16Units: 40, maxChunks: 5 })
  assert.deepEqual(chunks, ['exact-forty-char-one-chunk-of-text-here'])
})

test('formatter refuses to silently drop text that cannot fit the chunk budget', async () => {
  const { formatSlackReply, SlackReplyFormatError } = await bundleModule('src/reply.ts')
  assert.throws(
    () => formatSlackReply({ text: 'x'.repeat(100), maxChunkUtf16Units: 10, maxChunks: 5 }),
    SlackReplyFormatError,
  )
})

// ---- approval formatter (white-box: pure function) ----------------------------------------------

function approvalRequest(overrides) {
  return {
    text: 'Allow this action?',
    maxChunkUtf16Units: 4096,
    maxChunks: 8,
    approval: { approvalHandle: 'appr-1', approveLabel: 'Approve', denyLabel: 'Deny' },
    ...overrides,
  }
}

test('approval renders exactly one chunk plus a two-button actions block, both action_ids carrying the exact Core handle', async () => {
  const { formatSlackApproval } = await bundleModule('src/approval.ts')
  const result = formatSlackApproval(approvalRequest())
  assert.deepEqual(result.chunks, ['Allow this action?'])
  assert.equal(result.components, undefined)
  assert.deepEqual(result.blocks, [
    { type: 'section', text: { type: 'plain_text', text: 'Allow this action?' } },
    {
      type: 'actions',
      elements: [
        { type: 'button', action_id: 'saycode:approve:appr-1', text: { type: 'plain_text', text: 'Approve' } },
        { type: 'button', action_id: 'saycode:deny:appr-1', text: { type: 'plain_text', text: 'Deny' } },
      ],
    },
  ])
})

test('approval rejects a missing or empty approvalHandle/label/text', async () => {
  const { formatSlackApproval, SlackApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(() => formatSlackApproval(approvalRequest({ text: '' })), SlackApprovalFormatError)
  assert.throws(
    () => formatSlackApproval(approvalRequest({ approval: { approvalHandle: '', approveLabel: 'Approve', denyLabel: 'Deny' } })),
    SlackApprovalFormatError,
  )
  assert.throws(
    () => formatSlackApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: '', denyLabel: 'Deny' } })),
    SlackApprovalFormatError,
  )
  assert.throws(
    () => formatSlackApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: 'Approve', denyLabel: '' } })),
    SlackApprovalFormatError,
  )
})

test('approval rejects an oversized approvalHandle or label', async () => {
  const { formatSlackApproval, SlackApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatSlackApproval(approvalRequest({ approval: { approvalHandle: 'x'.repeat(81), approveLabel: 'Approve', denyLabel: 'Deny' } })),
    SlackApprovalFormatError,
  )
  assert.throws(
    () => formatSlackApproval(approvalRequest({ approval: { approvalHandle: 'appr-1', approveLabel: 'x'.repeat(76), denyLabel: 'Deny' } })),
    SlackApprovalFormatError,
  )
})

test('approval rejects text that cannot fit in the single chunk the result type allows', async () => {
  const { formatSlackApproval, SlackApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatSlackApproval(approvalRequest({ text: 'x'.repeat(50), maxChunkUtf16Units: 10 })),
    SlackApprovalFormatError,
  )
})

test('approval rejects text over Slack\'s own 3000-char section cap even when the caller\'s chunk budget is far more permissive', async () => {
  const { formatSlackApproval, SlackApprovalFormatError } = await bundleModule('src/approval.ts')
  assert.throws(
    () => formatSlackApproval(approvalRequest({ text: 'x'.repeat(3001), maxChunkUtf16Units: 65536 })),
    SlackApprovalFormatError,
  )
  // Exactly at the platform cap still succeeds.
  const result = formatSlackApproval(approvalRequest({ text: 'x'.repeat(3000), maxChunkUtf16Units: 65536 }))
  assert.equal(result.chunks[0].length, 3000)
})

// ---- intake runtime: activation lifecycle / command flow / duplicates / stop-in-flight ---------

function fakeCapabilities(receivePages, { onControl, controlDelay, onApproveOnce, approveOnceDelay } = {}) {
  const calls = []
  let receiveIndex = 0
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, action, args })
    if (permission === 'channels.receive') {
      const page = receivePages[Math.min(receiveIndex, receivePages.length - 1)]
      receiveIndex += 1
      return page
    }
    if (permission === 'sessions.control') {
      if (controlDelay) await controlDelay(args)
      return onControl?.(args) ?? { requestId: 'req', state: 'accepted' }
    }
    if (permission === 'sessions.approveOnce') {
      if (approveOnceDelay) await approveOnceDelay(args)
      return onApproveOnce?.(args) ?? { outcome: 'applied', status: 'The decision was applied.' }
    }
    if (permission === 'channels.ack') return { cursor: args.cursor }
    throw new Error(`unexpected capability: ${permission}`)
  }
  return { invokeCapability, calls }
}

test('activation lifecycle drives receive -> dispatch -> ack for each command', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/projects' }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/new landing page' }),
      envelope({ eventHandle: 'h3', semanticMessageId: 'm3', text: '/select sess-9' }),
      envelope({ eventHandle: 'h4', semanticMessageId: 'm4', text: '/status' }),
      envelope({ eventHandle: 'h5', semanticMessageId: 'm5', text: '/stop' }),
      envelope({ eventHandle: 'h6', semanticMessageId: 'm6', text: '자유 프롬프트 😀' }),
    ],
    cursor: '6',
  }
  const emptyPage = { events: [], cursor: '6' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => ({ eventHandle: call.args.eventHandle, operation: call.args.operation, sessionRef: call.args.sessionRef, text: call.args.text })), [
    { eventHandle: 'h1', operation: 'projects', sessionRef: undefined, text: undefined },
    { eventHandle: 'h2', operation: 'create', sessionRef: undefined, text: 'landing page' },
    { eventHandle: 'h3', operation: 'select', sessionRef: 'sess-9', text: undefined },
    { eventHandle: 'h4', operation: 'status', sessionRef: undefined, text: undefined },
    { eventHandle: 'h5', operation: 'stop', sessionRef: undefined, text: undefined },
    { eventHandle: 'h6', operation: 'prompt', sessionRef: undefined, text: '자유 프롬프트 😀' },
  ])
  const ids = controlCalls.map((call) => call.args.clientRequestId)
  assert.equal(new Set(ids).size, ids.length)
  assert.ok(ids.every((id) => typeof id === 'string' && id.length > 0))

  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '6')
  assert.ok(calls.indexOf(ackCalls[0]) > calls.lastIndexOf(controlCalls.at(-1)))
})

test('a message Slack marks bot-authored is dropped, not dispatched, but still acked (R11)', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'echo', sender: { bot: true } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status', sender: { bot: false } }),
    ],
    cursor: '2',
  }
  const emptyPage = { events: [], cursor: '2' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h2'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '2')
})

test('an envelope with a missing or malformed sender.bot flag fails closed: dropped and acked, never dispatched', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'echo', sender: undefined }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: 'echo', sender: {} }),
      envelope({ eventHandle: 'h3', semanticMessageId: 'm3', text: 'echo', sender: { bot: 'no' } }),
      envelope({ eventHandle: 'h4', semanticMessageId: 'm4', text: '/status', sender: { bot: false } }),
    ],
    cursor: '4',
  }
  const emptyPage = { events: [], cursor: '4' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h4'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
  assert.equal(ackCalls[0].args.cursor, '4')
})

test('an envelope carrying Core\'s validated action invokes sessions.approveOnce, not sessions.control', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({
        eventHandle: 'h1', semanticMessageId: 'm1', text: 'ignored',
        action: { approvalHandle: 'appr-1', decision: 'approve' },
      }),
    ],
    cursor: '1',
  }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 0)
  const approveCalls = calls.filter((call) => call.permission === 'sessions.approveOnce')
  assert.equal(approveCalls.length, 1)
  assert.deepEqual(approveCalls[0].args, {
    apiVersion: 1, eventHandle: 'h1', approvalHandle: 'appr-1', decision: 'approve',
  })
  // sessions.approveOnce's wire params are exactly these four fields — no clientRequestId.
  assert.deepEqual(Object.keys(approveCalls[0].args).sort(), ['apiVersion', 'approvalHandle', 'decision', 'eventHandle'])
  const ackCalls = calls.filter((call) => call.permission === 'channels.ack')
  assert.equal(ackCalls.length, 1)
})

test('text that merely looks like an approval action_id is never treated as proof — only the envelope\'s own action field routes to approveOnce', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      // No `action` field: an ordinary message whose *text* happens to contain the exact string
      // Core would have embedded in a real button's action_id. If this adapter ever started
      // pattern-matching `text` for that shape, this event would be misrouted to approveOnce.
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: 'saycode:approve:appr-1' }),
    ],
    cursor: '1',
  }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

  let stopped
  const stoppedSignal = new Promise((resolve) => { stopped = resolve })
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { stopped() },
  })
  runtime.start()
  await stoppedSignal
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.approveOnce').length, 0)
  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.equal(controlCalls.length, 1)
  assert.equal(controlCalls[0].args.operation, 'prompt')
  assert.equal(controlCalls[0].args.text, 'saycode:approve:appr-1')
})

test('stop mid-batch on an action envelope leaves it unacknowledged, same fencing as a command dispatch', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', action: { approvalHandle: 'appr-1', decision: 'deny' } }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/status' }),
    ],
    cursor: '2',
  }
  let stopPromise
  const { invokeCapability, calls } = fakeCapabilities([page1], {
    approveOnceDelay: async () => {
      // Stop lands while Core is still processing the approveOnce call for h1.
      stopPromise = runtime.stop()
      await new Promise((resolve) => setTimeout(resolve, 10))
    },
  })

  const runtime = createSlackIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await stopPromise

  const approveCalls = calls.filter((call) => call.permission === 'sessions.approveOnce')
  assert.deepEqual(approveCalls.map((call) => call.args.eventHandle), ['h1'])
  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 0)
  assert.equal(calls.filter((call) => call.permission === 'channels.ack').length, 0)
})

test('the default request-id minter works when crypto.randomUUID is absent (Desktop\'s data: URL host document is not a secure context)', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const originalRandomUUID = crypto.randomUUID
  delete crypto.randomUUID
  try {
    const page1 = { events: [envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })], cursor: '1' }
    const emptyPage = { events: [], cursor: '1' }
    const { invokeCapability, calls } = fakeCapabilities([page1, emptyPage])

    let stopped
    const stoppedSignal = new Promise((resolve) => { stopped = resolve })
    const runtime = createSlackIntakeRuntime({
      invokeCapability,
      connectionId: 'conn-1',
      sleep: async () => { stopped() },
    })
    runtime.start()
    await stoppedSignal
    await runtime.stop()

    const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
    assert.equal(controlCalls.length, 1)
    const id = controlCalls[0].args.clientRequestId
    assert.equal(typeof id, 'string')
    assert.ok(id.length > 0)
  } finally {
    crypto.randomUUID = originalRandomUUID
  }
})

test('the same message is never dispatched twice even if Core re-offers it', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const repeated = envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' })
  const page1 = { events: [repeated], cursor: '1' }
  const page2 = { events: [repeated], cursor: '1' }
  const emptyPage = { events: [], cursor: '1' }
  const { invokeCapability, calls } = fakeCapabilities([page1, page2, emptyPage])

  let iterations = 0
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { iterations += 1; await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  while (iterations < 4) await new Promise((resolve) => setImmediate(resolve))
  await runtime.stop()

  assert.equal(calls.filter((call) => call.permission === 'sessions.control').length, 1)
})

test('stop mid-batch leaves the batch unacknowledged and dispatches nothing after it', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const page1 = {
    events: [
      envelope({ eventHandle: 'h1', semanticMessageId: 'm1', text: '/status' }),
      envelope({ eventHandle: 'h2', semanticMessageId: 'm2', text: '/projects' }),
    ],
    cursor: '2',
  }
  let stopPromise
  const { invokeCapability, calls } = fakeCapabilities([page1], {
    controlDelay: async (args) => {
      if (args.eventHandle === 'h1') {
        stopPromise = runtime.stop()
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    },
  })

  const runtime = createSlackIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()
  await new Promise((resolve) => setTimeout(resolve, 50))
  await stopPromise

  const controlCalls = calls.filter((call) => call.permission === 'sessions.control')
  assert.deepEqual(controlCalls.map((call) => call.args.eventHandle), ['h1'])
  assert.equal(calls.filter((call) => call.permission === 'channels.ack').length, 0)
})

test('a receive failure backs off and does not ack, then recovers on the next window', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  let receiveCall = 0
  const errors = []
  const calls = []
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, args })
    if (permission === 'channels.receive') {
      receiveCall += 1
      if (receiveCall === 1) throw new Error('transient network error')
      return { events: [envelope({ text: '/status' })], cursor: '1' }
    }
    if (permission === 'sessions.control') return {}
    if (permission === 'channels.ack') return { cursor: args.cursor }
    throw new Error('unexpected')
  }

  let iterations = 0
  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    onError: (error) => errors.push(error),
    sleep: async () => { iterations += 1; await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  while (iterations < 3) await new Promise((resolve) => setImmediate(resolve))
  await runtime.stop()

  assert.equal(errors.length, 1)
  assert.match(errors[0].message, /transient network error/)
  assert.ok(calls.some((call) => call.permission === 'sessions.control'))
  assert.ok(calls.some((call) => call.permission === 'channels.ack'))
})

test('stop settles immediately even while idle backoff is parked at its 30s cap', async (t) => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const { SLACK_RECEIVE_MAX_MS } = await bundleModule('src/backoff.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })

  const invokeCapability = async (permission) => {
    if (permission === 'channels.receive') return { events: [], cursor: null }
    return {}
  }
  const runtime = createSlackIntakeRuntime({ invokeCapability, connectionId: 'conn-1' })
  runtime.start()

  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(SLACK_RECEIVE_MAX_MS)
    await new Promise((resolve) => setImmediate(resolve))
  }

  const settledWithoutTicking = await Promise.race([
    runtime.stop().then(() => true),
    new Promise((resolve) => setImmediate(() => resolve(false))),
  ])
  assert.equal(settledWithoutTicking, true)
})

test('a stale generation from a repeated start is discarded and stop waits for it too', async () => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const calls = []
  let releaseStaleReceive
  const staleReceiveGate = new Promise((resolve) => { releaseStaleReceive = resolve })
  let receiveCount = 0
  const invokeCapability = async (permission, action, args) => {
    calls.push({ permission, args })
    if (permission === 'channels.receive') {
      receiveCount += 1
      if (receiveCount === 1) {
        await staleReceiveGate
        return { events: [envelope({ eventHandle: 'stale', semanticMessageId: 'stale-msg' })], cursor: '1' }
      }
      return { events: [], cursor: null }
    }
    return {}
  }

  const runtime = createSlackIntakeRuntime({
    invokeCapability,
    connectionId: 'conn-1',
    sleep: async () => { await new Promise((resolve) => setImmediate(resolve)) },
  })
  runtime.start()
  runtime.start()

  releaseStaleReceive()
  await runtime.stop()

  assert.ok(!calls.some((call) => call.permission === 'sessions.control' && call.args.eventHandle === 'stale'))
  const callCountAtStop = calls.length
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(calls.length, callCountAtStop)
})

// ---- real activation wiring through the packed artifact + SDK test host -----------------------

test('the packaged extension wires channels.receive polling and the formatter through the real host', async () => {
  const packed = await packedSlack()
  try {
    const calls = []
    let firstReceiveSeen
    const firstReceive = new Promise((resolve) => { firstReceiveSeen = resolve })
    const host = createTestHost('buzzni.slack', {
      async invokeCapability(permission, action, args) {
        calls.push({ permission, action, args })
        if (permission === 'channels.receive') {
          firstReceiveSeen()
          return { events: [], cursor: null }
        }
        if (permission === 'channels.ack') return { cursor: args.cursor }
        return {}
      },
    })
    await host.activate(packed.extension)

    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.slack.bot',
      state: 'start',
      connectionId: 'conn-real',
      provider: 'slack',
      connectionRevision: 1,
    })
    await firstReceive
    assert.ok(calls.some((call) => call.permission === 'channels.receive' && call.args.connectionId === 'conn-real'))

    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.slack.bot',
      state: 'stop',
      connectionId: 'conn-real',
      provider: 'slack',
      connectionRevision: 1,
    })

    const formatted = await host.formatChannelReply({
      apiVersion: 1,
      channelId: 'buzzni.slack.bot',
      connectionId: 'conn-real',
      provider: 'slack',
      connectionRevision: 1,
      requestId: 'req-1',
      kind: 'final',
      text: '결과: 완료 🎉',
      maxChunkUtf16Units: 4096,
      maxChunks: 8,
    })
    assert.deepEqual(formatted.chunks, ['결과: 완료 🎉'])

    const formattedApproval = await host.formatChannelReply({
      apiVersion: 1,
      channelId: 'buzzni.slack.bot',
      connectionId: 'conn-real',
      provider: 'slack',
      connectionRevision: 1,
      requestId: 'req-2',
      kind: 'approval',
      text: 'Allow this action?',
      maxChunkUtf16Units: 4096,
      maxChunks: 8,
      approval: { approvalHandle: 'appr-real-1', approveLabel: 'Approve', denyLabel: 'Deny' },
    })
    assert.deepEqual(formattedApproval.chunks, ['Allow this action?'])
    assert.equal(formattedApproval.blocks[1].elements[0].action_id, 'saycode:approve:appr-real-1')
    assert.equal(formattedApproval.blocks[1].elements[1].action_id, 'saycode:deny:appr-real-1')

    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

test('a stop for a connection this host never started is a no-op', async () => {
  const packed = await packedSlack()
  try {
    const host = createTestHost('buzzni.slack', {
      async invokeCapability() { return { events: [], cursor: null } },
    })
    await host.activate(packed.extension)
    await host.deliverChannelLifecycle({
      apiVersion: 1,
      channelId: 'buzzni.slack.bot',
      state: 'stop',
      connectionId: 'conn-never-started',
      provider: 'slack',
      connectionRevision: 1,
    })
    await host.deactivate()
  } finally {
    await rm(packed.temporary, { recursive: true, force: true })
  }
})

/**
 * specs/desktop-channel-personal-chat R6 — `/clear` leaves the session this conversation follows.
 *
 * Core refuses a proposal that disagrees with its own classification of the recorded text, so
 * before this word was mapped here it reached the `default` arm as `prompt` and Core refused it
 * with `OPERATION_NOT_FROM_SOURCE`: `/clear` did not work for anyone. The word list is a contract
 * with a separately released Core, not an internal detail of this package.
 */
test('/clear and /reset map to the clear operation Core classifies', async () => {
  const { parseSlackCommand } = await bundleModule('src/commands.ts')
  // No `text`, exactly like /status and /stop: the operation takes no argument.
  assert.deepEqual(parseSlackCommand('/clear'), { operation: 'clear' })
  // Unlisted alias, same as Core's catalogue.
  assert.deepEqual(parseSlackCommand('/reset'), { operation: 'clear' })
  // An argument does not change the classification — Core reads `/clear anything` as `clear`, so
  // proposing anything else here would be the mismatch this mapping exists to avoid.
  assert.deepEqual(parseSlackCommand('/clear now'), { operation: 'clear' })
  assert.deepEqual(parseSlackCommand('/CLEAR'), { operation: 'clear' })
  // Still plain text when it is not the command word.
  assert.deepEqual(parseSlackCommand('clear the cache please'), { operation: 'prompt', text: 'clear the cache please' })
})

// ---- intake hints (specs/channel-intake-wake) --------------------------------------------------

async function hintedHost(extension, hostOptions) {
  const waiting = []
  const dispatched = []
  const counter = { receives: 0 }
  const host = createTestHost('buzzni.slack', {
    ...hostOptions,
    async invokeCapability(permission, action, args) {
      if (permission === 'channels.receive') {
        counter.receives += 1
        return { events: waiting.splice(0), cursor: waiting.length === 0 ? null : '1' }
      }
      if (permission === 'sessions.control') dispatched.push(args.eventHandle)
      return {}
    },
  })
  await host.activate(extension)
  const identity = { apiVersion: 1, channelId: 'buzzni.slack.bot', connectionId: 'conn-hint', provider: 'slack', connectionRevision: 1 }
  await host.deliverChannelLifecycle({ ...identity, state: 'start' })
  return { host, identity, waiting, dispatched, counter }
}
const settleHint = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve)) }

test('with a Desktop that sends intake hints, a quiet connection polls rarely and a hint fetches a new message at once', async (t) => {
  const packed = await packedSlack()
  t.after(() => rm(packed.temporary, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, identity, waiting, dispatched, counter } = await hintedHost(packed.extension)
  for (let i = 0; i < 300; i++) { t.mock.timers.tick(1_000); await settleHint() }
  assert.ok(counter.receives <= 20, `polled ${counter.receives} times in five quiet minutes`)

  waiting.push(envelope({ eventHandle: 'hinted', semanticMessageId: 'hinted-msg' }))
  await host.deliverIntake(identity)
  await settleHint()
  assert.deepEqual(dispatched, ['hinted'])
  await host.deliverChannelLifecycle({ ...identity, state: 'stop' })
  await host.deactivate()
})

test('with an older Desktop that has no onIntake, activation still works and a message is fetched within 3s', async (t) => {
  const packed = await packedSlack()
  t.after(() => rm(packed.temporary, { recursive: true, force: true }))
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const { host, identity, waiting, dispatched, counter } = await hintedHost(packed.extension, { intake: false })
  for (let i = 0; i < 300; i++) { t.mock.timers.tick(1_000); await settleHint() }
  const before = counter.receives
  while (counter.receives === before) { t.mock.timers.tick(1_000); await settleHint() }
  waiting.push(envelope({ eventHandle: 'polled', semanticMessageId: 'polled-msg' }))
  t.mock.timers.tick(3_000)
  await settleHint()
  assert.deepEqual(dispatched, ['polled'])
  await host.deliverChannelLifecycle({ ...identity, state: 'stop' })
  await host.deactivate()
})

test('a hint that lands while a receive is in flight is not lost to the long idle wait', async (t) => {
  const { createSlackIntakeRuntime } = await bundleModule('src/intakeLoop.ts')
  const { SLACK_RECEIVE_MAX_MS } = await bundleModule('src/backoff.ts')
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const waiting = []
  const dispatched = []
  let receives = 0
  let releaseReceive = null
  const invokeCapability = async (permission, action, args) => {
    if (permission === 'channels.receive') {
      receives += 1
      const events = waiting.splice(0)
      if (receives === 3) await new Promise((resolve) => { releaseReceive = resolve })
      return { events, cursor: events.length === 0 ? null : '1' }
    }
    if (permission === 'sessions.control') dispatched.push(args.eventHandle)
    return {}
  }
  const runtime = createSlackIntakeRuntime({ invokeCapability, connectionId: 'conn-1', idleMaxMs: SLACK_RECEIVE_MAX_MS })
  runtime.start()
  while (releaseReceive === null) { t.mock.timers.tick(1_000); await settleHint() }
  // The message lands after this receive read the queue, so it comes back empty; the hint for it
  // arrives while the call is still out.
  waiting.push(envelope({ eventHandle: 'late', semanticMessageId: 'late-msg' }))
  runtime.hint()
  releaseReceive()
  await settleHint()
  assert.deepEqual(dispatched, ['late'])
  await runtime.stop()
})
