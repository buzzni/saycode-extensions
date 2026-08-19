#!/usr/bin/env node
/**
 * Publishes @buzzni/saycode-extension-sdk to the public npm registry, skipping versions already published.
 *
 * Run from the repository root. Pass `--dry-run` to resolve and report the decision without publishing.
 * Requires NODE_AUTH_TOKEN in the environment when it actually publishes.
 */
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'

import { decidePublish } from './lib/npmPublishGate.mjs'

const workspace = '@buzzni/saycode-extension-sdk'
const dryRun = process.argv.includes('--dry-run')

const manifest = JSON.parse(await readFile(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'))
const { name, version } = manifest

if (name !== workspace) {
  throw new Error(`expected ${workspace} but packages/sdk declares ${name}`)
}

// Without `files`, npm publishes the whole workspace including `src/` and build config.
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('packages/sdk/package.json must keep a "files" whitelist — without it npm publishes everything')
}

// `files` only ships what exists. Publishing before a build would put a permanently empty version on the
// registry, and npm reports that as success. Checking the entry points, not just the dist directory,
// catches a partial build too.
// npm allows string shorthands for both fields ({bin: "dist/cli.js"}, {".": "./dist/index.js"});
// Object.values on a string would split it into characters and fail the check with a nonsense path.
const pathsOf = (entry) => (typeof entry === 'string' ? [entry] : Object.values(entry ?? {}))
const shippedPaths = [
  ...manifest.files,
  ...pathsOf(manifest.bin),
  ...pathsOf(manifest.exports).flatMap(pathsOf),
]
for (const entry of shippedPaths) {
  try {
    await access(new URL(`../packages/sdk/${entry}`, import.meta.url))
  } catch {
    throw new Error(`packages/sdk/${entry} is missing — run "npm run build" before publishing`)
  }
}

const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8' })
if (view.error) throw view.error

const decision = decidePublish({
  name,
  version,
  exitCode: view.status ?? 1,
  stdout: view.stdout ?? '',
  stderr: view.stderr ?? '',
})

if (!decision.publish) {
  console.log(`skipping publish: ${decision.reason}`)
  process.exit(0)
}

console.log(`publishing ${name}@${version}: ${decision.reason}`)

const args = ['publish', '--workspace', name]
if (dryRun) args.push('--dry-run')

const published = spawnSync('npm', args, { stdio: 'inherit' })
if (published.error) throw published.error
process.exit(published.status ?? 1)
