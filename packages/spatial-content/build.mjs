import { build } from 'esbuild'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { VIEWER_STYLES } from './scene.mjs'

const root = new URL('./', import.meta.url)
const read = (path, encoding) => readFile(new URL(path, root), encoding)
const [template, styles, lobby, showroom] = await Promise.all([
  read('panel.html', 'utf8'), read('panel.css', 'utf8'), read('lobby.jpg'), read('showroom.jpg'),
])
const sample = gzipSync(await read('photoreal-lobby-pilot.glb'))
const sampleModule = 'export default ' + JSON.stringify(sample.toString('base64')) + '\n'
if (Buffer.byteLength(sampleModule) > 5 * 1024 * 1024) throw new Error('Desktop loads at most 5 MiB per extension module')
await mkdir(new URL('assets/', root), { recursive: true })
await writeFile(new URL('assets/photoreal-lobby-pilot.mjs', root), sampleModule)
const dataUrl = (image) => 'data:image/jpeg;base64,' + image.toString('base64')
const bundled = await build({
  stdin: {
    contents: "import './studio.mjs'; import './studio-3d.mjs';",
    resolveDir: fileURLToPath(root),
  },
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  charset: 'utf8',
  minify: true,
  write: false,
  define: {
    SPATIAL_SAMPLE_LOBBY: JSON.stringify(dataUrl(lobby)),
    SPATIAL_SAMPLE_SHOWROOM: JSON.stringify(dataUrl(showroom)),
  },
})
const script = bundled.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const panel = template
  .replace('<!-- studio-styles -->', () => '<style>' + styles + '\n' + VIEWER_STYLES + '</style>')
  .replace('<!-- studio-script -->', () => '<script>' + script + '</script>')
if (Buffer.byteLength(panel) > 512 * 1024) throw new Error('Desktop loads at most 512 KiB per extension panel')
await mkdir(new URL('dist/', root), { recursive: true })
await writeFile(new URL('dist/panel.html', root), panel)
