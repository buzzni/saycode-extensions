#!/usr/bin/env node
/**
 * Publishes @buzzni/shorts-director to the public npm registry, skipping versions already published.
 *
 * Same gate as publish-sdk.mjs (ADR-046): only npm's structured "not published" answer triggers a publish.
 * There is no build step — the package ships its sources as they are. Pass `--dry-run` to only report.
 * Requires NODE_AUTH_TOKEN in the environment when it actually publishes.
 */
import { spawnSync } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'

import { decidePublish } from './lib/npmPublishGate.mjs'

const workspace = '@buzzni/shorts-director'
const dryRun = process.argv.includes('--dry-run')

const manifest = JSON.parse(await readFile(new URL('../packages/shorts-director/package.json', import.meta.url), 'utf8'))
const { name, version } = manifest

if (name !== workspace) {
  throw new Error(`expected ${workspace} but packages/shorts-director declares ${name}`)
}
if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
  throw new Error('packages/shorts-director/package.json must keep a "files" whitelist — without it npm publishes tests too')
}
for (const entry of [...manifest.files, ...Object.values(manifest.bin ?? {})]) {
  await access(new URL(`../packages/shorts-director/${entry}`, import.meta.url))
}

const view = spawnSync('npm', ['view', `${name}@${version}`, 'version', '--json'], { encoding: 'utf8' })
if (view.error) throw view.error

const decision = decidePublish({ name, version, exitCode: view.status ?? 1, stdout: view.stdout ?? '', stderr: view.stderr ?? '' })
if (!decision.publish) {
  console.log(`skipping publish: ${decision.reason}`)
  process.exit(0)
}

console.log(`publishing ${name}@${version}: ${decision.reason}`)
const args = ['publish', '--workspace', name, '--access', 'public']
if (dryRun) args.push('--dry-run')
const published = spawnSync('npm', args, { stdio: 'inherit' })
if (published.error) throw published.error
process.exit(published.status ?? 1)
