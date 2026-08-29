import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import {
  signCatalogWithOpenBao,
  validateCatalogPayload,
} from '../scripts/lib/extensionCatalogSigning.mjs'

const RELEASE = 'https://github.com/buzzni/saycode-extensions/releases/tag/v0.4.0'
const ARCHIVE = 'https://github.com/buzzni/saycode-extensions/releases/download/v0.4.0/'
  + 'buzzni.artifact-publisher-1.0.0.saycode-extension'

function payload(overrides = {}) {
  return {
    schemaVersion: 2,
    generatedAt: '2026-08-29T03:04:05.000Z',
    extensions: [{
      id: 'buzzni.artifact-publisher',
      version: '1.0.0',
      releaseUrl: RELEASE,
      archiveUrl: ARCHIVE,
      sha256: 'a'.repeat(64),
    }],
    revoked: [],
    ...overrides,
  }
}

function payloadBytes(value = payload()) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

function rawPublicKey(publicKey) {
  const spki = publicKey.export({ format: 'der', type: 'spki' })
  return Buffer.from(spki.subarray(spki.length - 32))
}

function keyMetadata(overrides = {}) {
  return {
    data: {
      name: 'extension-catalog-test',
      type: 'ed25519',
      derived: false,
      deletion_allowed: false,
      exportable: false,
      allow_plaintext_backup: false,
      supports_signing: true,
      latest_version: 1,
      ...overrides,
    },
  }
}

function successfulBao(publicKey, privateKey, calls) {
  return async (args, stdin = '') => {
    calls.push({ args, stdin })
    const path = args[2]
    if (path === 'catalog-transit/keys/extension-catalog-test') {
      return JSON.stringify(keyMetadata())
    }
    if (path === 'catalog-transit/sign/extension-catalog-test') {
      const signature = sign(null, Buffer.from(stdin, 'base64'), privateKey).toString('base64')
      return JSON.stringify({ data: { signature: `vault:v1:${signature}` } })
    }
    if (path === 'catalog-transit/export/public-key/extension-catalog-test/1') {
      return JSON.stringify({
        data: { name: 'extension-catalog-test', keys: { 1: rawPublicKey(publicKey).toString('base64') } },
      })
    }
    throw new Error(`unexpected bao call: ${args.join(' ')}`)
  }
}

test('signer preserves and signs the exact payload bytes', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const bytes = payloadBytes()
  const calls = []

  const result = await signCatalogWithOpenBao({
    payloadBytes: bytes,
    mount: 'catalog-transit',
    keyName: 'extension-catalog-test',
    runBao: successfulBao(publicKey, privateKey, calls),
  })

  assert.equal(result.envelope.schemaVersion, 2)
  assert.equal(result.envelope.payload, bytes.toString('base64'))
  assert.equal(result.publicKeyBase64, rawPublicKey(publicKey).toString('base64'))
  assert.deepEqual(calls.map((call) => call.args), [
    ['read', '-format=json', 'catalog-transit/keys/extension-catalog-test'],
    ['write', '-format=json', 'catalog-transit/sign/extension-catalog-test', 'input=-'],
    ['read', '-format=json', 'catalog-transit/export/public-key/extension-catalog-test/1'],
  ])
  assert.equal(calls[1].stdin, bytes.toString('base64'))
})

test('payload validator requires a timestamp newer than the previously verified catalog', () => {
  assert.throws(
    () => validateCatalogPayload(payloadBytes(), { previousGeneratedAt: '2026-08-29T03:04:05.000Z' }),
    /newer than/i,
  )
  assert.equal(
    validateCatalogPayload(payloadBytes(), { previousGeneratedAt: '2026-08-29T03:04:04.999Z' }).generatedAt,
    '2026-08-29T03:04:05.000Z',
  )
})

test('payload validator rejects malformed or non-first-party catalog fields before signing', async () => {
  const malformed = [
    { ...payload(), extra: true },
    payload({ extensions: [payload().extensions[0], payload().extensions[0]] }),
    payload({ extensions: [{ ...payload().extensions[0], archiveUrl: 'https://example.com/x' }] }),
    payload({ extensions: [{ ...payload().extensions[0], sha256: 'A'.repeat(64) }] }),
  ]
  for (const candidate of malformed) {
    let called = false
    await assert.rejects(
      signCatalogWithOpenBao({
        payloadBytes: payloadBytes(candidate),
        mount: 'catalog-transit',
        keyName: 'extension-catalog-test',
        runBao: async () => { called = true; return '{}' },
      }),
    )
    assert.equal(called, false)
  }
})

test('signer refuses an OpenBao key whose custody policy is weaker than approved', async () => {
  for (const override of [
    { type: 'ecdsa-p256' },
    { derived: true },
    { deletion_allowed: true },
    { exportable: true },
    { allow_plaintext_backup: true },
    { supports_signing: false },
  ]) {
    const calls = []
    await assert.rejects(
      signCatalogWithOpenBao({
        payloadBytes: payloadBytes(),
        mount: 'catalog-transit',
        keyName: 'extension-catalog-test',
        runBao: async (args, stdin = '') => {
          calls.push({ args, stdin })
          return JSON.stringify(keyMetadata(override))
        },
      }),
      /OpenBao key/i,
    )
    assert.equal(calls.length, 1)
  }
})

test('signer rejects malformed signatures, malformed public keys, and signature mismatches', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const other = generateKeyPairSync('ed25519')
  const cases = [
    {
      signature: 'not-versioned',
      publicKey: rawPublicKey(publicKey).toString('base64'),
      expected: /signature/i,
    },
    {
      signature: `vault:v1:${Buffer.alloc(63).toString('base64')}`,
      publicKey: rawPublicKey(publicKey).toString('base64'),
      expected: /64 bytes/i,
    },
    {
      signature: `vault:v1:${sign(null, payloadBytes(), privateKey).toString('base64')}`,
      publicKey: Buffer.alloc(31).toString('base64'),
      expected: /32 bytes/i,
    },
    {
      signature: `vault:v1:${sign(null, payloadBytes(), privateKey).toString('base64')}`,
      publicKey: rawPublicKey(other.publicKey).toString('base64'),
      expected: /did not verify/i,
    },
  ]

  for (const candidate of cases) {
    await assert.rejects(
      signCatalogWithOpenBao({
        payloadBytes: payloadBytes(),
        mount: 'catalog-transit',
        keyName: 'extension-catalog-test',
        runBao: async (args) => {
          const path = args[2]
          if (path.includes('/keys/')) return JSON.stringify(keyMetadata())
          if (path.includes('/sign/')) return JSON.stringify({ data: { signature: candidate.signature } })
          return JSON.stringify({
            data: { name: 'extension-catalog-test', keys: { 1: candidate.publicKey } },
          })
        },
      }),
      candidate.expected,
    )
  }
})

test('signing sources never inspect or print the ambient OpenBao token', async () => {
  const source = [
    await readFile(new URL('../scripts/lib/extensionCatalogSigning.mjs', import.meta.url), 'utf8'),
    await readFile(new URL('../scripts/sign-extension-catalog.mjs', import.meta.url), 'utf8'),
  ].join('\n')

  assert.doesNotMatch(source, /BAO_TOKEN|X-Vault-Token|process\.env/)
})
