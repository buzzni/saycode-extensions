#!/usr/bin/env node
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { build, context } from 'esbuild'
import JSZip from 'jszip'
import { parseExtensionManifest, type ExtensionManifest } from './manifest.js'

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function scaffold(projectPath: string): Promise<void> {
  const id = argument('--id') ?? basename(resolve(projectPath)).toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
  const root = resolve(projectPath)
  await mkdir(join(root, 'src'), { recursive: true })
  const files: Record<string, string> = {
    'package.json': JSON.stringify({
      name: id,
      private: true,
      version: '1.0.0',
      type: 'module',
      scripts: {
        validate: 'saycode-extension validate .',
        dev: 'saycode-extension dev .',
        pack: 'saycode-extension pack .',
      },
      dependencies: { '@buzzni/saycode-extension-sdk': '^0.1.0' },
    }, null, 2) + '\n',
    'extension.json': JSON.stringify({
      id,
      version: '1.0.0',
      apiVersion: 1,
      engines: { saycode: '^1.0.0' },
      entrypoint: 'index.js',
      permissions: [],
      activationEvents: [`onCommand:${id}.hello`],
      contributes: { commands: [{ id: `${id}.hello`, title: 'Hello' }] },
    }, null, 2) + '\n',
    'src/index.ts': [
      "import { defineExtension } from '@buzzni/saycode-extension-sdk'",
      '',
      'export default defineExtension({',
      '  activate(context) {',
      `    context.commands.register('${id}.hello', (name) => \`Hello \${String(name ?? 'Saycode')}!\`)`,
      '  },',
      '})',
      '',
    ].join('\n'),
  }
  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(root, relativePath)
    if (await exists(path)) throw new Error(`refusing to overwrite ${path}`)
    await writeFile(path, content)
  }
  console.log(`Created ${id} in ${root}`)
}

async function manifestAt(projectPath: string): Promise<ExtensionManifest> {
  const path = join(resolve(projectPath), 'extension.json')
  let value: unknown
  try { value = JSON.parse(await readFile(path, 'utf8')) } catch (error) {
    throw new Error(`cannot read extension manifest: ${error instanceof Error ? error.message : String(error)}`)
  }
  return parseExtensionManifest(value, { supportedApiVersion: 1 })
}

async function bundle(projectPath: string, outfile: string, watch: boolean): Promise<void> {
  const options = {
    bundle: true,
    entryPoints: [join(resolve(projectPath), 'src/index.ts')],
    format: 'esm' as const,
    logLevel: 'silent' as const,
    outfile,
    platform: 'browser' as const,
    target: ['chrome120'],
  }
  if (!watch) {
    await build(options)
    return
  }
  const buildContext = await context(options)
  await buildContext.watch()
  console.log(`Watching ${resolve(projectPath)}`)
  await new Promise(() => undefined)
}

async function develop(projectPath: string): Promise<void> {
  await manifestAt(projectPath)
  const output = join(resolve(projectPath), '.saycode/dev/index.js')
  await mkdir(resolve(output, '..'), { recursive: true })
  await bundle(projectPath, output, !process.argv.includes('--once'))
  if (process.argv.includes('--once')) console.log(output)
}

async function pack(projectPath: string): Promise<void> {
  const root = resolve(projectPath)
  const manifest = await manifestAt(root)
  const staging = await mkdtemp(join(tmpdir(), 'saycode-extension-pack-'))
  try {
    const entrypoint = join(staging, 'index.js')
    await bundle(root, entrypoint, false)
    const zip = new JSZip()
    zip.file('extension.json', JSON.stringify({ ...manifest, entrypoint: 'index.js' }, null, 2))
    zip.file('index.js', await readFile(entrypoint))
    const output = resolve(argument('--output') ?? join(root, `${manifest.id}-${manifest.version}.saycode-extension`))
    await mkdir(resolve(output, '..'), { recursive: true })
    await writeFile(output, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }))
    console.log(output)
  } finally {
    await rm(staging, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const command = process.argv[2]
  const projectPath = process.argv[3]
  if (!command || !projectPath) throw new Error('usage: saycode-extension <scaffold|validate|dev|pack> <path>')
  if (command === 'scaffold') return scaffold(projectPath)
  if (command === 'validate') { console.log((await manifestAt(projectPath)).id); return }
  if (command === 'dev') return develop(projectPath)
  if (command === 'pack') return pack(projectPath)
  throw new Error(`unknown command: ${command}`)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
