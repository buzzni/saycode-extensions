/**
 * Decides whether a tagged release should publish the SDK to npm (ADR-046).
 *
 * A tag can be re-run, and an npm version can only be published once, so the release workflow must treat
 * "this version already exists" as success rather than failure. The only signal that may trigger a publish is
 * npm's structured E404 ("not published") — measured on npm 10, both "package never published" and "package
 * exists, version absent" report it on stdout under --json. Every other outcome is an error: publishing on an
 * ambiguous signal would push an unintended artifact to a public, effectively permanent registry.
 */

/** Reads `{"error":{"code":"..."}}`, the shape `npm view --json` prints on stdout when it fails. */
function readErrorCode(stdout) {
  if (stdout === '') return undefined
  try {
    const parsed = JSON.parse(stdout)
    const code = parsed?.error?.code
    return typeof code === 'string' ? code : undefined
  } catch {
    return undefined
  }
}

/**
 * @param {{ name: string, version: string, exitCode: number, stdout: string, stderr: string }} query
 * @returns {{ publish: boolean, reason: string }}
 */
export function decidePublish(query) {
  const { name, version, exitCode, stdout, stderr } = query

  if (!name) throw new Error('npm publish gate requires a package name')
  if (!version) throw new Error('npm publish gate requires an exact version')

  const trimmed = stdout.trim()

  if (exitCode !== 0) {
    const code = readErrorCode(trimmed)
    if (code === 'E404') {
      return { publish: true, reason: `${name}@${version} is not published yet` }
    }
    if (code) {
      throw new Error(`npm view ${name} failed with ${code} (exit ${exitCode})`)
    }
    throw new Error(`npm view ${name} failed unexpectedly (exit ${exitCode}): ${stderr.trim() || '<no stderr>'}`)
  }

  if (trimmed === '') {
    throw new Error(`npm view ${name} succeeded with empty output — not a confirmed "not published" signal`)
  }

  let parsed
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    throw new Error(`could not parse npm view output for ${name}: ${trimmed}`)
  }

  // `npm view ... version --json` returns a string for one match and an array of strings for several.
  // Any other shape is unrecognised: silently treating it as "no match" would publish over an existing release.
  const versions = Array.isArray(parsed) ? parsed : [parsed]
  if (!versions.every((entry) => typeof entry === 'string')) {
    throw new Error(`unexpected npm view response shape for ${name}: ${trimmed}`)
  }

  if (versions.includes(version)) {
    return { publish: false, reason: `${name}@${version} is already published` }
  }

  return { publish: true, reason: `${name}@${version} is not published yet` }
}
