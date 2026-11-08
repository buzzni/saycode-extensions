# Saycode Extension developer guide

## Quick Start

The SDK is published to the public npm registry, so the Quick Start needs no checkout of this repository:

```bash
npx @buzzni/saycode-extension-sdk scaffold hello-extension --id com.example.hello
cd hello-extension
npm install
npm run validate
npm run dev -- --once
npm run pack
```

The result is `com.example.hello-1.0.0.saycode-extension`. The scaffolded command is lazy: Desktop activates the
extension only when `com.example.hello.hello` is first invoked.

Repository contributors testing an unreleased SDK change should build from this checkout instead of installing the
published package, so the CLI and the scaffolded dependency come from the same working tree:

```bash
# In saycode-extensions
npm ci
npm run build
mkdir -p .artifacts
npm pack --workspace @buzzni/saycode-extension-sdk --pack-destination .artifacts
node packages/sdk/dist/cli.js scaffold /tmp/hello-extension --id com.example.hello

# In the newly scaffolded directory
cd /tmp/hello-extension
npm install /path/to/saycode-extensions/.artifacts/buzzni-saycode-extension-sdk-0.1.0.tgz
npm run validate
npm run dev -- --once
npm run pack
```

Replace the example repository and `/tmp` paths with local paths; do not commit the generated tarball.

`packages/sdk/README.md` is the published, self-contained copy of the contracts below. It stays free of repository-
relative links so every link also works on npmjs.com; `tests/sdk-publish.test.mjs` enforces that.

## Public API

Only these imports are stable:

```ts
import { defineExtension, type ExtensionContext, type JsonValue } from '@buzzni/saycode-extension-sdk'
import { parseExtensionManifest } from '@buzzni/saycode-extension-sdk/manifest'
```

`defineExtension` accepts `activate(context)` and optional `deactivate()`. `context.commands.register(id, handler)`
registers a namespaced command. Arguments and results must be JSON values: null, finite numbers, booleans, strings,
arrays, or plain objects composed from those values. Importing undocumented package subpaths is rejected by package
exports. Importing Saycode Desktop source, `@buzzni/saycode-core`, Electron, VS Code, or Node built-ins is forbidden.

## Manifest

`extension.json` is the package contract:

```json
{
  "id": "com.example.hello",
  "version": "1.0.0",
  "apiVersion": 1,
  "engines": { "saycode": "^1.0.0" },
  "entrypoint": "index.js",
  "permissions": [],
  "activationEvents": ["onCommand:com.example.hello.hello"],
  "contributes": {
    "commands": [{ "id": "com.example.hello.hello", "title": "Hello" }]
  }
}
```

Ids are lowercase stable namespaces. Versions use semantic versioning. Paths are relative, forward-slash paths without
empty, `.` or `..` segments. API versions and permissions are closed sets; an unknown value is rejected before execution.
Supported v1 contributions are `commands`, typed `settings`, isolated `panels`, and `projectTemplates`.

A project template keeps the original v1 `id`, `title`, and `assetsRoot` fields and may add the UI metadata below:

```json
{
  "projectTemplates": [{
    "id": "com.example.templates.dashboard",
    "title": "Dashboard",
    "description": "Dashboard starter",
    "stack": "React",
    "firstPrompt": "Build a dashboard",
    "devServerCommand": "npm run dev",
    "assetsRoot": "templates/dashboard",
    "localizations": {
      "ko": {
        "title": "대시보드",
        "description": "대시보드 시작점",
        "firstPrompt": "대시보드를 만들어줘"
      }
    }
  }]
}
```

The four UI fields `description`, `stack`, `firstPrompt`, and `devServerCommand` are optional for v1 compatibility,
but Desktop lists only templates that provide all four. `localizations` may override `title`, `description`, and
`firstPrompt`; lookup falls back from an exact locale to its base language and then to the default fields. Asset paths
must stay relative to `assetsRoot`; Desktop reads them through bounded host APIs rather than exposing installation paths.

## Lifecycle and permissions

Installation validates and stores an extension but leaves it disabled. Enablement exposes contributions without loading
extension code. An activation event loads the browser bundle in the isolated host. Disablement removes contributions and
deactivates the host. Three consecutive crashes quarantine the extension until manual recovery. Updates require an
inactive extension and preserve the last-known-good version for rollback.

Protected work must use an SDK capability when one becomes available. A manifest declaration and current user approval
are both required. Extensions never receive raw auth tokens, E2EE secrets, sync credentials, unrestricted Electron/Node
objects, or ambient filesystem/network/process access.

## UI contributions

Extensions cannot import React components into the Saycode renderer. `panels` name a packaged HTML entrypoint rendered
in an isolated surface with origin/schema checks and no raw credential bridge. Settings and project templates are
declarative descriptors. Keep stable contribution ids namespaced by the extension id; collisions disable registration.

## Testing and debugging

Use `@buzzni/saycode-extension-test-host` to activate an extension and invoke registered commands without Desktop.
Run `saycode-extension validate .` before building and `saycode-extension dev . --once` for a deterministic browser
bundle. The bundler targets a browser and deliberately fails imports such as `node:fs`, `node:net`, `child_process`, or
`electron`. Runtime exceptions and timeouts appear in **Settings → Extensions**; repeated crashes enter quarantine.

Repository gates are package-owned:

```bash
npm test
npm run typecheck
npm run package:fixture
```

## First-party Project Templates

`packages/project-templates` is the single source for the official starter ids, metadata, four-locale strings, asset
trees, and their content hashes. Desktop owns only the generic contribution/install/security contract and a
checksum-pinned integration smoke; do not copy exact starter content or content assertions back into Desktop.

Run the complete package gates before releasing a change:

```bash
npm test
npm run typecheck
npm run package:project-templates
npm run verify:project-templates
```

The verifier installs each starter into an isolated temporary project, builds it, starts its development server, and
then terminates that server. A `v*` tag packages the extension and publishes the artifact plus `.sha256` from the same
workflow run.

## Versioning and compatibility

Use semantic versions for extension releases. `apiVersion` is the wire schema version and changes only for incompatible
contract changes. `engines.saycode` states the compatible Desktop line. The release gate tests the current and previous
supported API fixtures; unsupported versions must fail with an explanatory message. Do not deep-import SDK internals to
avoid that gate.

## Packaging and release

`saycode-extension pack .` validates the manifest, creates a browser ESM bundle, and writes a deterministic package
shape containing `extension.json` and `index.js`. A Git tag matching `v*` runs all tests, packages the official fixture,
generates SHA-256 metadata, attaches both files to a GitHub release, and publishes the SDK to the public npm registry
when its version is not already published. Marketplace listing, automatic update, artifact signing, and revocation are
separate approvals and are not performed by this workflow.

The release tag (`v0.4.0`) and the SDK version (`packages/sdk/package.json`) are independent. The job publishes
only when the SDK version is not already on the registry, so **an SDK change without a version bump is skipped
silently** — the workflow logs `skipping publish: ... is already published` and still succeeds. Bump
`packages/sdk/package.json` in the same PR as any change to `packages/sdk/`.

`npm publish` always moves the `latest` dist-tag to the version it publishes. Publishing an older-line hotfix
(say 0.1.1 after 0.2.0 is out) would repoint `latest` at the hotfix, so plain `npm i` would start serving the
old line. If that situation ever comes up, pass an explicit `--tag` in `scripts/publish-sdk.mjs` for that release.

### npm publish token

The `publish-sdk` job authenticates with the repository secret `NPM_TOKEN`. Nothing else in this repository reads it,
and it never appears in a checked-in file.

To create or rotate it:

1. On npmjs.com, sign in as a maintainer of the `@buzzni` scope and create a **Granular access token** scoped to
   `@buzzni/saycode-extension-sdk` with **Read and write** permission. Choose the shortest expiry the release cadence
   allows; a token that can publish any `@buzzni` package is broader than this workflow needs.
   **First publish only**: a package that has never been published cannot be selected, so scope the token to the
   `@buzzni` organization instead, and rotate to a package-scoped token right after the first release.
2. Register it at **Settings → Secrets and variables → Actions → New repository secret**, named `NPM_TOKEN`.
3. Revoke the previous token on npmjs.com after a release confirms the new one works.

To revoke access entirely, delete the token on npmjs.com first, then remove the repository secret. Deleting only the
secret leaves a live publish credential outstanding.

Verify the publish decision without touching the registry state:

```bash
npm run publish:sdk -- --dry-run
```

`scripts/lib/npmPublishGate.mjs` owns that decision and fails closed: it publishes only on a confirmed "version not
published" signal, and treats any other registry response as an error rather than guessing.

## Security rules

- Never request or log credentials, cookies, encryption keys, or raw authorization headers.
- Never hide a required permission behind a generic label.
- Treat command arguments, panel messages, stored values, and remote content as untrusted input.
- Do not add postinstall scripts, symlinks, absolute paths, path traversal, dynamic Node imports, or native binaries.
- Keep network, file, machine, notification, and storage operations behind the smallest declared capability.
- Report a suspected sandbox or capability bypass privately using [SECURITY.md](../SECURITY.md).

## Asset workflow (SDK 0.4.1 / host engine 1.1.0)

API 3 remains current, with API 2 still supported. New asset extensions declare `engines.saycode: "^1.1.0"`; older hosts fail closed. The CLI includes a package's optional `assets/` directory using the same traversal/symlink checks as project-template files. Do not put private user originals or credentials in an artifact.

The four permissions are separate grants: `assets.read` (list/describe/open/readChunk/close), `assets.write` (create/update/remove and begin/writeChunk/seal for instruction text), `files.select` (native pick/readChunk/close), and `drafts.prepare` (context/prepare/commit/cancel). Call `context.invokeCapability(permission, action, {version: 1, ...args})`. Core supplies the authenticated caller; no user ID, URL, credential, arbitrary machine command or absolute path is accepted. `assets.read/open` accepts either an artifact-relative `path`, or private `id`, `revision`, `role` (source/instructions/preview). `readChunk` accepts handle/offset and returns base64, nextOffset and done.

Originals are limited to 10 MiB each and 20 MiB per extension/principal scope. Chunks are 24 KiB, handles expire after 5 minutes of inactivity, and calls are bounded to 120 seconds. Editing uses contiguous byte offsets then a SHA-256 seal. Create takes name/sourceHandle/preserve; update takes id/expectedRevision and name/sourceHandle/instructionHandle; remove takes id/expectedRevision. Core shows a native confirmation and rechecks the revision. A failed or timed-out write may have reached the server: reload before retrying, never automatically repeat a create.

`context` returns targetId/revision/private for the composer that opened the panel. `prepare` takes targetId/revision/text/handles and returns preparationId. `commit` confirms then appends to that same unedited draft; it never sends a message or creates a session. Private originals cannot enter project or organizational drafts. Cancellation, navigation, account changes, permission revocation and host stop invalidate pending work. After applying, users review and send using the normal composer.

The panel must use `window.saycodePanel.ready` and `invokeCommand`, not install a competing MessagePort listener. It has no network or Node access. Renderer migration is outside this release: the document template package uses retained public previews and authenticated existing Web previews.

Panels run in an opaque-origin iframe framed with `sandbox="allow-scripts"`: forms never submit and `crypto.subtle` is unavailable. Save from button click handlers and hash in plain JavaScript; test panels in a harness that removes both.

## Session and worktree hooks (API 4 / engine 1.4.0, SDK 0.10.0)

Two declarative contribution points let an extension prepare the environment Saycode starts an agent in. Both need
`apiVersion: 4` and an `engines.saycode` range whose lower bound is at least `1.4.0` (for example `^1.4.0`);
`saycode-extension validate` refuses a lower range because older Desktop builds do not know these contributions.

| Contribution | Permission (declared together, both ways) | What Saycode does |
|---|---|---|
| `sessionHooks[]` | `sessions.launchEnvironment` | Adds env variables and MCP servers to every conversation session it creates or resumes |
| `worktreeHooks[]` | `worktrees.prepare` | Copies Git-ignored files from the original checkout into each new worktree |

```json
{
  "apiVersion": 4,
  "engines": { "saycode": "^1.4.0" },
  "permissions": ["sessions.launchEnvironment", "worktrees.prepare"],
  "activationEvents": ["onSessionOpenBefore:com.example.tools.company"],
  "contributes": {
    "sessionHooks": [
      {
        "id": "com.example.tools.docs",
        "event": "session.open.before",
        "env": [{ "name": "EXAMPLE_DOCS_URL" }, { "name": "EXAMPLE_DOCS_TOKEN", "secret": true }],
        "mcpServers": [
          { "name": "example-docs", "transport": "stdio", "command": "npx", "args": ["-y", "@example/docs-mcp@1.2.3"], "envNames": ["EXAMPLE_DOCS_TOKEN"] },
          { "name": "example-remote", "transport": "http", "url": "https://mcp.example.com/v1", "headerEnvNames": { "Authorization": "EXAMPLE_DOCS_TOKEN" } }
        ]
      },
      { "id": "com.example.tools.company", "event": "session.open.before", "scope": "company", "dynamic": true, "env": [{ "name": "EXAMPLE_WORKSPACE" }] }
    ],
    "worktreeHooks": [
      { "id": "com.example.tools.prepare", "event": "worktree.create.after", "copyIgnored": [".env.local"] }
    ]
  }
}
```

Session hook rules (the parser mirrors Desktop and rejects anything else, including unknown fields):

- At most 4 hooks per contribution point. Hook ids start with the extension id and are unique among all contributions.
  `scope` is `all` (default) or `company` (only projects that belong to a company).
- `env`: at most 32 names matching `^[A-Z][A-Z0-9_]{0,63}$`. Reserved names are refused: `PATH`, `HOME`, `USER`,
  `LOGNAME`, `SHELL`, `PWD`, `TMPDIR`, `TERM`, `PORT`, `NODE_OPTIONS`, `NODE_PATH`, `SSH_AUTH_SOCK`, and anything
  starting with `HAPPY_`, `SAYCODE_`, `APLUS_`, `LD_`, `DYLD_`, `GIT_`, `ANTHROPIC_`, `CLAUDE_`, `OPENAI_` or `CODEX_`.
- `mcpServers`: at most 8, names matching `^[a-z][a-z0-9_-]{0,31}$`, not starting with `happy`, `saycode` or `aplus`,
  and not `cua-driver` (the daemon adds `happy` and `cua-driver` itself).
  A `stdio` server has a bare `command` (no path) that is not a shell or indirection (`sh`, `bash`, `env`, `xargs`,
  `ssh`, `sudo`, `osascript`, …), at most 32 fixed `args` of up to 512 characters, and `envNames` from the same hook.
  An interpreter such as `node` or `python` may not run inline code (`-e`, `-c`, `-p`, `--eval`, …). An `http` server
  has an `https:` URL without credentials, and each `headerEnvNames` entry must name a **secret** env of the same hook.
- A hook injects at least one env name or server. Env and server names are unique across one extension's hooks.
- `dynamic: true` requires the activation event `onSessionOpenBefore:<hookId>` and a handler registered during
  `activate`:

```ts
import { defineExtension } from '@buzzni/saycode-extension-sdk'

export default defineExtension({
  activate(context) {
    context.sessionHooks?.onOpenBefore('com.example.tools.company', (input) =>
      input.project.companyId ? { env: { EXAMPLE_WORKSPACE: `company-${input.project.companyId}` } } : {})
  },
})
```

The handler receives `SessionOpenBeforeInput` — `{ reason: 'create' | 'resume', sessionKind, agent, project: { id,
companyId?, repository?: { name, remoteHost? } } }`, with no local path, token or conversation text — and returns
`SessionOpenBeforeResult`: `env` with values (strings up to 8192 characters, no NUL) for the hook's declared
**non-secret** names, and optionally `mcpServers`, the declared server names to start this time (omitted means all).
Any other result drops the extension's whole injection for that session.

Trust model:

- Secret env values are entered by the person in Saycode and kept in its secret store. They never reach the extension
  host, and a handler can never return one. Without a value, that env name and every server that needs it are left out.
- MCP commands, arguments and URLs are fixed in the manifest and shown to the person when they approve the permission.
  A handler only fills declared values and picks declared servers; it cannot add or change a launch line. Approval is
  tied to the extension version and its hook declarations, so an update that changes them asks again.
- A hook never blocks a session or a worktree. A timeout, crash, invalid result, missing secret or name conflict drops
  that extension's injection (never part of it) and the session still starts; a failed copy leaves the worktree in place.
  When two extensions declare the same name, both are dropped; a name the person set on the project wins over an
  extension.
- Values are recomputed at every session open and are not stored in project settings or session metadata.

Worktree hooks in v1 support only `copyIgnored`: 1 to 32 safe relative paths (no absolute path, `..`, or `.git`
segment). Saycode copies only regular files that Git ignores, never follows symlinks, and does not overwrite a file
that already exists in the new worktree. There is no command step in v1; a `machineCommand` field is rejected.

`@buzzni/saycode-extension-test-host` accepts the parsed `manifest` option, registers only declared dynamic hooks, and
`host.openSessionBefore(hookId, input)` rejects a result Desktop would drop.

The `examples/session-env-sample` (static env, secret env, a fixed `npx` stdio server and a dynamic hook) and
`examples/worktree-prepare-sample` (`.env.local`) packages are packed and run in the test host by
`tests/launch-hooks.test.mjs`.
