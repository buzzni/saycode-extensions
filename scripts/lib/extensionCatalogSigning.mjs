import { createPublicKey, verify } from 'node:crypto'
import { spawn } from 'node:child_process'

const SCHEMA_VERSION = 2
const MAX_PAYLOAD_BYTES = 256 * 1024
const MAX_BAO_OUTPUT_BYTES = 1024 * 1024
const RELEASE_URL_PREFIX = 'https://github.com/buzzni/saycode-extensions/releases/'
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const ISO_INSTANT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const OPENBAO_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex')

function fail(path, detail) {
  throw new Error(`${path}: ${detail}`)
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected object')
  return value
}

function exactRecord(value, keys, path) {
  const result = record(value, path)
  if (Object.keys(result).sort().join(',') !== [...keys].sort().join(',')) {
    fail(path, `expected exactly ${[...keys].sort().join(',')}`)
  }
  return result
}

function array(value, path) {
  if (!Array.isArray(value)) fail(path, 'expected array')
  return value
}

function string(value, path, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(path, 'malformed value')
  return value
}

function id(value, path) {
  const result = string(value, path, ID_PATTERN)
  if (result.includes('..')) fail(path, 'malformed value')
  return result
}

function releaseUrl(value, path) {
  const result = string(value, path, /^https:\/\/[^\s]+$/)
  if (!result.startsWith(RELEASE_URL_PREFIX) || result.includes('..')) {
    fail(path, 'expected a first-party release URL')
  }
  return result
}

function parseDescriptor(value, path) {
  const entry = exactRecord(value, ['id', 'version', 'releaseUrl', 'archiveUrl', 'sha256'], path)
  return {
    id: id(entry.id, `${path}.id`),
    version: string(entry.version, `${path}.version`, SEMVER_PATTERN),
    releaseUrl: releaseUrl(entry.releaseUrl, `${path}.releaseUrl`),
    archiveUrl: releaseUrl(entry.archiveUrl, `${path}.archiveUrl`),
    sha256: string(entry.sha256, `${path}.sha256`, SHA256_PATTERN),
  }
}

function parseRevocation(value, path) {
  const entry = record(value, path)
  const keys = Object.keys(entry).sort().join(',')
  if (keys !== 'id,version' && keys !== 'id,reason,version') fail(path, 'unexpected fields')
  return {
    id: id(entry.id, `${path}.id`),
    version: string(entry.version, `${path}.version`, SEMVER_PATTERN),
    ...(entry.reason === undefined
      ? {}
      : { reason: string(entry.reason, `${path}.reason`, /^.{1,200}$/s) }),
  }
}

function decodePayload(payloadBytes) {
  if (!(payloadBytes instanceof Uint8Array)) fail('catalog payload', 'expected bytes')
  if (payloadBytes.byteLength === 0) fail('catalog payload', 'must not be empty')
  if (payloadBytes.byteLength > MAX_PAYLOAD_BYTES) fail('catalog payload', 'catalog is too large')
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes)
  } catch {
    return fail('catalog payload', 'expected UTF-8')
  }
}

export function validateCatalogPayload(payloadBytes, options = {}) {
  let value
  try {
    value = JSON.parse(decodePayload(payloadBytes))
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('catalog payload:')) throw error
    return fail('catalog payload', 'expected JSON')
  }
  const catalog = exactRecord(value, ['schemaVersion', 'generatedAt', 'extensions', 'revoked'], 'catalog')
  if (catalog.schemaVersion !== SCHEMA_VERSION) {
    fail('catalog.schemaVersion', `unsupported catalog schema ${String(catalog.schemaVersion)}`)
  }
  const generatedAt = string(catalog.generatedAt, 'catalog.generatedAt', ISO_INSTANT_PATTERN)
  const timestamp = Date.parse(generatedAt)
  if (!Number.isFinite(timestamp)) fail('catalog.generatedAt', 'malformed value')
  if (options.previousGeneratedAt !== undefined) {
    const previous = Date.parse(options.previousGeneratedAt)
    if (!ISO_INSTANT_PATTERN.test(options.previousGeneratedAt) || !Number.isFinite(previous)) {
      fail('previousGeneratedAt', 'malformed value')
    }
    if (timestamp <= previous) fail('catalog.generatedAt', 'must be newer than the previous catalog')
  }
  const extensions = array(catalog.extensions, 'catalog.extensions')
    .map((entry, index) => parseDescriptor(entry, `catalog.extensions[${index}]`))
  if (new Set(extensions.map((entry) => entry.id)).size !== extensions.length) {
    fail('catalog.extensions', 'duplicate extension id')
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    extensions,
    revoked: array(catalog.revoked, 'catalog.revoked')
      .map((entry, index) => parseRevocation(entry, `catalog.revoked[${index}]`)),
  }
}

function parseJson(output, path) {
  try {
    return JSON.parse(output)
  } catch {
    return fail(path, 'OpenBao returned non-JSON output')
  }
}

function parseKeyMetadata(output, keyName) {
  const response = record(parseJson(output, 'OpenBao key'), 'OpenBao key response')
  const key = record(response.data, 'OpenBao key data')
  const expected = {
    name: keyName,
    type: 'ed25519',
    derived: false,
    deletion_allowed: false,
    exportable: false,
    allow_plaintext_backup: false,
    supports_signing: true,
  }
  for (const [field, value] of Object.entries(expected)) {
    if (key[field] !== value) fail('OpenBao key', `${field} must be ${JSON.stringify(value)}`)
  }
  if (!Number.isInteger(key.latest_version) || key.latest_version < 1) {
    fail('OpenBao key', 'latest_version must be a positive integer')
  }
  return key.latest_version
}

function decodeBase64(value, path, expectedBytes) {
  if (typeof value !== 'string' || !BASE64_PATTERN.test(value) || value.length % 4 !== 0) {
    fail(path, 'expected canonical base64')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.toString('base64') !== value) fail(path, 'expected canonical base64')
  if (bytes.byteLength !== expectedBytes) fail(path, `must be ${expectedBytes} bytes`)
  return bytes
}

function parseSignature(output) {
  const response = record(parseJson(output, 'OpenBao signature'), 'OpenBao signature response')
  const data = record(response.data, 'OpenBao signature data')
  if (typeof data.signature !== 'string') fail('OpenBao signature', 'missing versioned signature')
  const match = /^vault:v([1-9]\d*):(.+)$/.exec(data.signature)
  if (!match) fail('OpenBao signature', 'expected vault:vN:<base64>')
  return {
    keyVersion: Number(match[1]),
    signature: decodeBase64(match[2], 'OpenBao signature', 64),
  }
}

function parsePublicKey(output, keyName, keyVersion) {
  const response = record(parseJson(output, 'OpenBao public key'), 'OpenBao public key response')
  const data = record(response.data, 'OpenBao public key data')
  if (data.name !== keyName) fail('OpenBao public key', `name must be ${JSON.stringify(keyName)}`)
  const keys = record(data.keys, 'OpenBao public key versions')
  return decodeBase64(keys[String(keyVersion)], 'OpenBao public key', 32)
}

function openBaoName(value, path) {
  if (typeof value !== 'string' || !OPENBAO_NAME_PATTERN.test(value)) {
    fail(path, 'expected a lowercase OpenBao path segment')
  }
  return value
}

export async function signCatalogWithOpenBao(input) {
  validateCatalogPayload(input.payloadBytes, { previousGeneratedAt: input.previousGeneratedAt })
  const mount = openBaoName(input.mount, 'mount')
  const keyName = openBaoName(input.keyName, 'keyName')
  if (typeof input.runBao !== 'function') fail('runBao', 'expected function')

  const latestVersion = parseKeyMetadata(
    await input.runBao(['read', '-format=json', `${mount}/keys/${keyName}`]),
    keyName,
  )
  const payloadBase64 = Buffer.from(input.payloadBytes).toString('base64')
  const signed = parseSignature(await input.runBao(
    ['write', '-format=json', `${mount}/sign/${keyName}`, 'input=-'],
    payloadBase64,
  ))
  if (signed.keyVersion > latestVersion) {
    fail('OpenBao signature', 'key version is newer than the inspected key')
  }
  const publicKey = parsePublicKey(
    await input.runBao([
      'read',
      '-format=json',
      `${mount}/export/public-key/${keyName}/${signed.keyVersion}`,
    ]),
    keyName,
    signed.keyVersion,
  )
  const verifier = createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, publicKey]),
    format: 'der',
    type: 'spki',
  })
  if (!verify(null, input.payloadBytes, verifier, signed.signature)) {
    fail('OpenBao signature', 'did not verify with the exported public key')
  }
  return {
    envelope: {
      schemaVersion: SCHEMA_VERSION,
      payload: payloadBase64,
      signature: signed.signature.toString('base64'),
    },
    publicKeyBase64: publicKey.toString('base64'),
    keyVersion: signed.keyVersion,
  }
}

export function runBaoCommand(baoPath, args, stdin = '') {
  return new Promise((resolve, reject) => {
    const child = spawn(baoPath, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    const stdout = []
    let stdoutBytes = 0
    let exceeded = false
    child.stdout.on('data', (chunk) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > MAX_BAO_OUTPUT_BYTES) {
        exceeded = true
        child.kill()
        return
      }
      stdout.push(chunk)
    })
    child.stderr.resume()
    child.on('error', () => reject(new Error('failed to start bao CLI')))
    child.on('close', (code) => {
      if (exceeded) return reject(new Error('bao CLI output exceeded 1 MiB'))
      if (code !== 0) return reject(new Error(`bao ${args[0] ?? 'command'} failed with exit code ${String(code)}`))
      resolve(Buffer.concat(stdout).toString('utf8'))
    })
    child.stdin.end(stdin)
  })
}
