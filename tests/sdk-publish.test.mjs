import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { access, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const root = fileURLToPath(new URL('..', import.meta.url))
const sdk = join(root, 'packages/sdk')

const readSdkManifest = async () => JSON.parse(await readFile(join(sdk, 'package.json'), 'utf8'))

// The SDK is published to npmjs.org public while `buzzni/saycode-extensions` stays private (ADR-046).
// Everything below guards the two things that publishing makes permanent: what ships in the tarball,
// and what an outside reader can reach from the npm package page alone.

test('sdk package declares the metadata a public scoped publish requires', async () => {
  const manifest = await readSdkManifest()

  assert.equal(manifest.name, '@buzzni/saycode-extension-sdk')
  assert.ok(manifest.description, 'description is shown on the npm package page')
  assert.ok(manifest.license, 'a public package without a license is unusable by others')
  assert.equal(
    manifest.publishConfig?.access,
    'public',
    'scoped packages default to restricted; omitting this publishes privately',
  )
  assert.ok(manifest.engines?.node, 'engines.node states the supported runtime')
  assert.ok(Array.isArray(manifest.keywords) && manifest.keywords.length > 0)
})

test('sdk package omits repository metadata while the source repository is private', async () => {
  const manifest = await readSdkManifest()

  // A `repository` pointing at a private repo renders as a 404 link on the npm package page.
  // ADR-046 re-adds this when the repository becomes public.
  assert.equal(manifest.repository, undefined)
  assert.equal(manifest.homepage, undefined)
})

test('sdk package stays on 0.x so the compatibility promise stays limited', async () => {
  const manifest = await readSdkManifest()

  assert.match(manifest.version, /^0\./)
})

test('sdk ships a license file matching the repository license', async () => {
  await access(join(sdk, 'LICENSE'))

  // The published copy is separate from the repository root's, so nothing stops the two from drifting
  // and shipping terms that were never agreed to.
  const [shipped, repository] = await Promise.all([
    readFile(join(sdk, 'LICENSE'), 'utf8'),
    readFile(join(root, 'LICENSE'), 'utf8'),
  ])
  assert.equal(shipped, repository)

  const manifest = await readSdkManifest()
  assert.match(shipped, new RegExp(`^${manifest.license} License`, 'm'))
})

test('sdk readme is self-contained for readers who cannot open the repository', async () => {
  const readme = await readFile(join(sdk, 'README.md'), 'utf8')

  // Any target that is not an absolute URL or an in-page anchor resolves inside the private repository,
  // so it 404s for the npm readers this README exists for. `../x`, `./x`, and a bare `docs/x.md` all count.
  const linkTargets = [...readme.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1].trim())
  const unreachable = linkTargets.filter((target) => !/^(https?:\/\/|mailto:|#)/.test(target))
  assert.deepEqual(unreachable, [], 'links resolve inside the private repository only')

  assert.doesNotMatch(readme, /not yet published/i)
  // The reader must be able to get from nothing to a packaged artifact using only what this file shows.
  assert.match(readme, /npx @buzzni\/saycode-extension-sdk scaffold/)
  for (const command of ['validate', 'dev', 'pack']) {
    assert.match(readme, new RegExp(`npm run ${command}`))
  }
  assert.match(readme, /npm i -D @buzzni\/saycode-extension-sdk/)
})

test('scaffolded projects depend on the SDK at build time only', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'saycode-scaffold-dep-'))
  const project = join(temporary, 'hello-extension')
  try {
    await exec('node', [join(sdk, 'dist/cli.js'), 'scaffold', project, '--id', 'com.example.hello'])
    const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))

    // `pack` inlines the SDK into the browser bundle, so nothing resolves it at runtime. Declaring it as a
    // runtime dependency would also pull the CLI's esbuild/jszip into every extension author's tree.
    assert.equal(manifest.dependencies, undefined)
    // The range must track the CLI that generated the project: a hardcoded `^0.1.0` would keep installing
    // the 0.1.x line after the SDK moves to 0.2.0, since caret ranges do not cross 0.x minors.
    const { version } = await readSdkManifest()
    assert.equal(manifest.devDependencies?.['@buzzni/saycode-extension-sdk'], `^${version}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})

test('publish script completes a dry run end to end', async () => {
  // Everything else here checks inputs; this actually executes scripts/publish-sdk.mjs — its manifest guards,
  // entry-point checks, registry query, and gate — stopping only at npm's own --dry-run. Without it the script
  // has zero coverage and a broken relative path inside it would surface for the first time on a release tag.
  const { stdout } = await exec('node', [join(root, 'scripts/publish-sdk.mjs'), '--dry-run'], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 8,
  })

  assert.match(stdout, /^(publishing|skipping publish)/m)
})

test('published tarball contains only build output, readme, license, and manifest', async () => {
  const { stdout } = await exec('npm', ['pack', '--dry-run', '--json', '-w', '@buzzni/saycode-extension-sdk'], {
    cwd: root,
    maxBuffer: 1024 * 1024 * 8,
  })
  const [packed] = JSON.parse(stdout)
  const files = packed.files.map((entry) => entry.path).sort()

  const unexpected = files.filter(
    (path) => !path.startsWith('dist/') && !['README.md', 'LICENSE', 'package.json'].includes(path),
  )
  assert.deepEqual(unexpected, [], 'files whitelist leaked non-published paths')
  assert.ok(files.includes('LICENSE'))
  assert.ok(files.includes('README.md'))
  assert.ok(files.some((path) => path === 'dist/index.js'))
  // Source and build configuration stay out of the published artifact.
  assert.equal(files.some((path) => path.startsWith('src/')), false)
  assert.equal(files.includes('tsconfig.json'), false)
})
