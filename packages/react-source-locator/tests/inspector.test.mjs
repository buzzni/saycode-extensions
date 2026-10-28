import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { JSDOM } from 'jsdom'
import { parseExtensionManifest } from '../../sdk/dist/manifest.js'

// Desktop specs/element-pick-source-inspector R9: the inspector Desktop runs in the page for a picked element.
const script = await readFile(new URL('../inspector.js', import.meta.url), 'utf8')
const manifest = JSON.parse(await readFile(new URL('../extension.json', import.meta.url), 'utf8'))
// Run the way Desktop runs it: as script inside a page window, not as a Node module.
const page = new JSDOM('<button>Pay</button>', { runScripts: 'outside-only', url: 'http://localhost:5173/' }).window
Object.assign(page, { TextDecoder, Response })
const inspect = page.eval(script)
// Desktop gets the answer copied out of the page (executeJavaScript), so compare plain data.
const run = async (node) => JSON.parse(JSON.stringify(await inspect(node)))

function element(fiber, key = '__reactFiber$x1y2') {
  const node = page.document.createElement('button')
  if (fiber) node[key] = fiber
  return node
}
function PayButton() {}

/** A base64 VLQ source map with one segment: generated (line, col) → original (line, col), both 0-based. */
function vlq(value) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  let v = value < 0 ? ((-value) << 1) | 1 : value << 1, out = ''
  do { let digit = v & 31; v >>>= 5; if (v) digit |= 32; out += chars[digit] } while (v)
  return out
}
function sourceMap({ generatedLine, generatedColumn, originalLine, originalColumn, source }) {
  const mappings = ';'.repeat(generatedLine) + [generatedColumn, 0, originalLine, originalColumn].map(vlq).join('')
  return { version: 3, sources: [source], names: [], mappings }
}
function stack(frame) {
  return { stack: `Error: react-stack-top-frame\n    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=9:250:30)\n    at ${frame}\n    at renderWithHooks (http://localhost:5173/node_modules/.vite/deps/react-dom_client.js?v=9:5000:22)` }
}

test('the package declares only the inspector and its permission on API 4', () => {
  const parsed = parseExtensionManifest(manifest, { supportedApiVersion: 4, minimumSupportedApiVersion: 2 })
  assert.deepEqual(parsed.permissions, ['browserPicks.inspect'])
  assert.deepEqual(parsed.contributes.elementPickInspectors, [{ id: 'buzzni.react-source-locator.source', title: 'React source', script: 'inspector.js' }])
  assert.ok(Buffer.byteLength(script) < 64 * 1024)
})

test('React 18 and earlier: the host fiber _debugSource and its owner', async () => {
  const fiber = { type: 'button', _debugSource: { fileName: '/repo/src/components/Pay.tsx', lineNumber: 12, columnNumber: 5 }, _debugOwner: { type: PayButton } }
  assert.deepEqual(await run(element(fiber, '__reactInternalInstance$abc')), { componentName: 'PayButton', file: '/repo/src/components/Pay.tsx', line: 12, column: 5 })
})

test('React 19: the first user frame of _debugStack, mapped back through an inline source map', async () => {
  const map = sourceMap({ generatedLine: 11, generatedColumn: 6, originalLine: 19, originalColumn: 4, source: 'PayButton.tsx' })
  const code = `export function PayButton() {}\n//# sourceMappingURL=data:application/json;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n`
  const urls = []
  page.fetch = async (url) => { urls.push(String(url)); return new Response(code) }
  const fiber = { type: 'button', _debugStack: stack('PayButton (http://localhost:5173/src/components/PayButton.tsx?t=17:12:7)'), _debugOwner: { type: PayButton } }
  assert.deepEqual(await run(element(fiber)), { componentName: 'PayButton', file: 'src/components/PayButton.tsx', line: 20, column: 5 })
  assert.deepEqual(urls, ['http://localhost:5173/src/components/PayButton.tsx?t=17'])
})

test('React 19 with a webpack map file: strips the webpack:// prefix', async () => {
  const map = sourceMap({ generatedLine: 0, generatedColumn: 0, originalLine: 7, originalColumn: 2, source: 'webpack://_N_E/./src/app/page.tsx' })
  page.fetch = async (url) => new Response(String(url).endsWith('.map') ? JSON.stringify(map) : 'x()\n//# sourceMappingURL=page.js.map')
  const fiber = { type: 'div', _debugStack: stack('Page (http://localhost:3000/_next/static/chunks/app/page.js:1:1)'), _debugOwner: { type: { displayName: 'Page' } } }
  assert.deepEqual(await run(element(fiber)), { componentName: 'Page', file: 'src/app/page.tsx', line: 8, column: 3 })
})

test('React 19 without a usable map falls back to the served path and generated position', async () => {
  page.fetch = async () => { throw new Error('offline') }
  const fiber = { type: 'button', _debugStack: stack('http://localhost:5173/src/App.tsx?t=1:40:9'), _debugOwner: { type: { render: function Inner() {} } } }
  assert.deepEqual(await run(element(fiber)), { componentName: 'Inner', file: 'src/App.tsx', line: 40, column: 9 })
})

test('no React, or a production build with no debug data, answers null', async () => {
  assert.equal(await run(element(null)), null)
  assert.equal(await run(element({ type: 'button', return: null })), null)
})

test('falls back to the nearest component ancestor for a name when there is no owner', async () => {
  const fiber = { type: 'span', _debugSource: { fileName: 'src/Card.tsx', lineNumber: 3 }, return: { type: 'div', return: { type: function Card() {} } } }
  assert.deepEqual(await run(element(fiber)), { componentName: 'Card', file: 'src/Card.tsx', line: 3 })
})
