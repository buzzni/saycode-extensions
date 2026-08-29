#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import {
  runBaoCommand,
  signCatalogWithOpenBao,
} from './lib/extensionCatalogSigning.mjs'

function usage() {
  return [
    'usage: node scripts/sign-extension-catalog.mjs',
    '  --payload <catalog-payload.json>',
    '  --output <catalog.v2.json>',
    '  --public-key-output <catalog-public-key.txt>',
    '  --mount <transit-mount> --key <key-name>',
    '  (--first-catalog | --previous-generated-at <ISO instant>)',
  ].join('\n')
}

function parseArguments(argv) {
  const options = { firstCatalog: false }
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index]
    if (name === '--first-catalog') {
      options.firstCatalog = true
      continue
    }
    if (![
      '--payload',
      '--output',
      '--public-key-output',
      '--mount',
      '--key',
      '--previous-generated-at',
    ].includes(name)) throw new Error(`unknown argument: ${String(name)}\n${usage()}`)
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`missing value for ${name}\n${usage()}`)
    options[name.slice(2)] = value
    index += 1
  }
  for (const required of ['payload', 'output', 'public-key-output', 'mount', 'key']) {
    if (!options[required]) throw new Error(`missing --${required}\n${usage()}`)
  }
  if (options.firstCatalog === Boolean(options['previous-generated-at'])) {
    throw new Error('choose exactly one of --first-catalog or --previous-generated-at')
  }
  const output = resolve(options.output)
  const publicKeyOutput = resolve(options['public-key-output'])
  if (output === publicKeyOutput) throw new Error('--output and --public-key-output must differ')
  return {
    payload: resolve(options.payload),
    output,
    publicKeyOutput,
    mount: options.mount,
    keyName: options.key,
    previousGeneratedAt: options['previous-generated-at'],
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  const payloadBytes = await readFile(options.payload)
  const signed = await signCatalogWithOpenBao({
    payloadBytes,
    mount: options.mount,
    keyName: options.keyName,
    previousGeneratedAt: options.previousGeneratedAt,
    runBao: runBaoCommand,
  })
  await writeFile(options.output, `${JSON.stringify(signed.envelope, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  await writeFile(options.publicKeyOutput, `${signed.publicKeyBase64}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  })
  console.log(`Signed catalog with OpenBao key version ${signed.keyVersion}`)
  console.log(options.output)
  console.log(options.publicKeyOutput)
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
