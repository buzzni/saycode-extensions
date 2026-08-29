#!/usr/bin/env node
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve, sep } from 'node:path'
import { build, context } from 'esbuild'
import JSZip from 'jszip'
import { parseExtensionManifest, type ExtensionManifest } from './manifest.js'

const ARCHIVE_DATE = new Date('2000-01-01T00:00:00.000Z')

function addFile(zip: JSZip, path: string, content: Uint8Array | string): void {
  zip.file(path, content, { createFolders: false, date: ARCHIVE_DATE })
}

function argument(name: string): string | null {
  const index = process.argv.indexOf(name)
  return index >= 0 ? process.argv[index + 1] ?? null : null
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}

async function sdkVersion(): Promise<string> {
  // dist/cli.js reads its own package manifest so scaffolded ranges track the CLI that generated them —
  // a hardcoded range would keep installing an older 0.x line after a minor bump, since caret ranges do
  // not cross 0.x minors.
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return manifest.version
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
      // Build-time only: `pack` inlines the SDK into the bundle, and a runtime declaration would drag the
      // CLI's esbuild/jszip into every extension author's dependency tree.
      devDependencies: { '@buzzni/saycode-extension-sdk': `^${await sdkVersion()}` },
    }, null, 2) + '\n',
    'extension.json': JSON.stringify({
      id,
      version: '1.0.0',
      apiVersion: 3,
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
  return parseExtensionManifest(value, { supportedApiVersion: 3, minimumSupportedApiVersion: 2 })
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

async function addDirectoryToZip(zip: JSZip, root: string, relativeDirectory: string): Promise<void> {
  const entries = (await readdir(join(root, relativeDirectory), { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))
  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isSymbolicLink()) throw new Error(`project-template assets cannot contain symlinks: ${relativePath}`)
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, root, relativePath)
    } else if (entry.isFile()) {
      addFile(zip, relativePath, await readFile(join(root, relativePath)))
    } else {
      throw new Error(`project-template asset must be a regular file: ${relativePath}`)
    }
  }
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
    addFile(zip, 'extension.json', JSON.stringify({ ...manifest, entrypoint: 'index.js' }, null, 2))
    addFile(zip, 'index.js', await readFile(entrypoint))
    const assetRoots = new Set((manifest.contributes.projectTemplates ?? []).map((template) => template.assetsRoot))
    for (const assetsRoot of assetRoots) await addDirectoryToZip(zip, root, assetsRoot)
    for (const panel of manifest.contributes.panels ?? []) {
      const panelPath = join(root, panel.entrypoint)
      const panelStat = await lstat(panelPath)
      if (panelStat.isSymbolicLink() || !panelStat.isFile()) {
        throw new Error(`panel entrypoint must be a regular file: ${panel.entrypoint}`)
      }
      const realRoot = await realpath(root)
      const realPanelPath = await realpath(panelPath)
      if (!realPanelPath.startsWith(`${realRoot}${sep}`)) {
        throw new Error(`panel entrypoint must stay inside the extension: ${panel.entrypoint}`)
      }
      addFile(zip, panel.entrypoint, await readFile(realPanelPath))
    }
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
