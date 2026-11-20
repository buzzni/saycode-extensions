import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildScene, exportExperience, imageMime, storyFileText } from '../packages/spatial-content/scene.mjs'

const png = 'data:image/png;base64,iVBORw0KGgo='
const input = {
  title: '  공간 둘러보기 ',
  environment: { name: '로비', image: png },
  character: { name: '안내 직원', image: png },
  story: '로비에 도착합니다.\r\n\r\n- 방문 등록을 합니다.\r\n2. 안내를 듣습니다.',
}

test('creates a versioned experience from the three inputs in story order', () => {
  const scene = buildScene(input)
  assert.equal(scene.version, 1)
  assert.equal(scene.title, '공간 둘러보기')
  assert.equal(scene.environment.name, '로비')
  assert.equal(scene.character.name, '안내 직원')
  assert.deepEqual(scene.steps.map(({ text }) => text), [
    '로비에 도착합니다.', '방문 등록을 합니다.', '안내를 듣습니다.',
  ])
  assert.equal(new Set(scene.steps.map(({ id }) => id)).size, 3)
  assert.equal(scene.steps.at(-1).next, null)
})

test('rejects missing parts, empty stories, too many steps and non-image sources', () => {
  for (const change of [
    { title: ' ' },
    { environment: null },
    { character: null },
    { story: ' \n ' },
    { story: Array.from({ length: 13 }, () => '설명').join('\n') },
    { environment: { name: '파일', image: 'https://example.test/file.png' } },
  ]) assert.throws(() => buildScene({ ...input, ...change }))
  assert.throws(() => buildScene({ ...input, story: '나'.repeat(401) }))
})

test('recognizes raster signatures and strictly decodes text uploads', () => {
  assert.equal(imageMime(Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])), 'image/png')
  assert.equal(imageMime(Uint8Array.from([255, 216, 255, 224])), 'image/jpeg')
  assert.equal(imageMime(new TextEncoder().encode('RIFF0000WEBP')), 'image/webp')
  assert.equal(imageMime(new TextEncoder().encode('<svg>')), null)
  assert.equal(storyFileText(new TextEncoder().encode('단계 안내')), '단계 안내')
  assert.throws(() => storyFileText(new Uint8Array([255, 0])))
})

test('serializes the same experience to standalone HTML and escapes authored text', () => {
  const scene = buildScene({ ...input, title: '</script><script>alert(1)</script>' })
  const html = exportExperience(scene)
  assert.match(html, /<!doctype html>/)
  assert.match(html, /다시 체험/)
  assert.match(html, /data:image\/png/)
  assert.ok(!html.includes(scene.title))
  assert.ok(!html.includes('src="http'))
})
