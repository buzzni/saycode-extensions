import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { FONTS, MUSIC, ensureAsset } from '../lib/assets.mjs'

async function serve(body, run) {
  let hits = 0
  const server = createServer((_, response) => {
    hits += 1
    response.end(body)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}/file`, () => hits)
  } finally {
    server.close()
  }
}

test('a public asset is downloaded once, checked against its sha256 and reused from the PC cache', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sd-assets-'))
  const body = Buffer.from('track bytes')
  try {
    await serve(body, async (url, hits) => {
      const asset = { file: 'song.mp3', url, sha256: createHash('sha256').update(body).digest('hex') }
      const path = await ensureAsset(asset, directory)
      assert.deepEqual(await readFile(path), body)
      await ensureAsset(asset, directory)
      assert.equal(hits(), 1, 'the second call uses the cached file')
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('a download that does not match its checksum is refused and not kept', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'sd-assets-'))
  try {
    await serve('tampered', async (url) => {
      await assert.rejects(ensureAsset({ file: 'song.mp3', url, sha256: '0'.repeat(64) }, directory), /sha256/)
      await assert.rejects(readFile(join(directory, 'song.mp3')))
    })
    await writeFile(join(directory, 'old.mp3'), 'stale')
    await serve('fresh', async (url) => {
      const asset = { file: 'old.mp3', url, sha256: createHash('sha256').update('fresh').digest('hex') }
      assert.equal(String(await readFile(await ensureAsset(asset, directory))), 'fresh', 'a cached file with the wrong hash is replaced')
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test('only openly licensed assets are listed: OFL fonts and CC0 music, each pinned by checksum', () => {
  assert.ok(FONTS.length >= 2)
  for (const font of FONTS) {
    assert.equal(font.license, 'OFL-1.1')
    assert.match(font.sha256, /^[0-9a-f]{64}$/)
    assert.match(font.url, /^https:\/\/(cdn\.jsdelivr\.net\/gh\/orioncactus\/pretendard@v\d|raw\.githubusercontent\.com\/google\/fonts\/[0-9a-f]{40}\/ofl\/)/, 'pinned to a release or a commit')
  }
  assert.ok(Object.keys(MUSIC).length >= 6)
  for (const [id, track] of Object.entries(MUSIC)) {
    assert.match(id, /^[a-z0-9-]+$/)
    assert.equal(track.license, 'CC0-1.0', id)
    assert.match(track.sha256, /^[0-9a-f]{64}$/, id)
    assert.ok(track.mood && track.source && Number.isFinite(track.lufs), id)
  }
})
