import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { parseExtensionManifest } from '../packages/sdk/dist/manifest.js'

const exec = promisify(execFile)

test('manifest parser rejects unknown APIs and unsafe paths', () => {
  const manifest = {
    id: 'buzzni.test', version: '1.0.0', apiVersion: 1,
    engines: { saycode: '^1.0.0' }, entrypoint: 'index.js', permissions: [],
    activationEvents: [], contributes: {},
  }
  assert.equal(parseExtensionManifest(manifest, { supportedApiVersion: 1 }).id, 'buzzni.test')
  assert.throws(() => parseExtensionManifest({ ...manifest, apiVersion: 2 }, { supportedApiVersion: 1 }), /unsupported/i)
  assert.throws(() => parseExtensionManifest({ ...manifest, entrypoint: '../index.js' }, { supportedApiVersion: 1 }), /entrypoint/i)
})

test('packed SDK installs and exposes only documented entrypoints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'saycode-sdk-pack-'))
  try {
    const packageJson = JSON.parse(await readFile(new URL('../packages/sdk/package.json', import.meta.url), 'utf8'))
    assert.deepEqual(Object.keys(packageJson.exports).sort(), ['.', './manifest'])
    const sdkRoot = new URL('../packages/sdk', import.meta.url).pathname
    const { stdout } = await exec('npm', ['pack', sdkRoot, '--pack-destination', directory, '--json'])
    const [{ filename }] = JSON.parse(stdout)
    await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
    await exec('npm', ['install', join(directory, filename)], { cwd: directory })
    await exec('node', ['--input-type=module', '-e', "import { defineExtension } from '@buzzni/saycode-extension-sdk'; if (!defineExtension) process.exit(1)"], { cwd: directory })
    await assert.rejects(
      exec('node', ['--input-type=module', '-e', "import '@buzzni/saycode-extension-sdk/internal'"], { cwd: directory }),
      /not defined by "exports"|ERR_PACKAGE_PATH_NOT_EXPORTED/,
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
