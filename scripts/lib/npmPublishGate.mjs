/**
 * Decides whether a tagged release should publish the SDK to npm (ADR-046).
 *
 * A tag can be re-run, and an npm version can only be published once, so the release workflow must treat
 * "this version already exists" as success rather than failure. Every other registry outcome is an error:
 * publishing on an ambiguous signal would push an unintended artifact to a public, effectively permanent registry.
 */

/**
 * @param {{ name: string, version: string, exitCode: number, stdout: string, stderr: string }} query
 * @returns {{ publish: boolean, reason: string }}
 */
export function decidePublish(query) {
  const { name, version, exitCode, stdout, stderr } = query

  if (!name) throw new Error('npm publish gate requires a package name')
  if (!version) throw new Error('npm publish gate requires an exact version')

  if (exitCode !== 0) {
    // A missing package is the expected first-publish signal; anything else is a registry or auth problem.
    if (/\bE404\b/.test(stderr) || /\b404 Not Found\b/.test(stderr)) {
      return { publish: true, reason: `${name} is not published yet` }
    }
    throw new Error(`npm view ${name} failed unexpectedly (exit ${exitCode}): ${stderr.trim() || '<no stderr>'}`)
  }

  const trimmed = stdout.trim()
  if (trimmed === '') {
    return { publish: true, reason: `${name} has no published versions` }
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
