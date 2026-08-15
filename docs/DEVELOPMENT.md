# Saycode Extension developer guide

## Quick Start

Follow these commands from a new directory after installing the SDK CLI:

```bash
saycode-extension scaffold hello-extension --id com.example.hello
cd hello-extension
npm install
npm run validate
npm run dev -- --once
npm run pack
```

The result is `com.example.hello-1.0.0.saycode-extension`. The scaffolded command is lazy: Desktop activates the
extension only when `com.example.hello.hello` is first invoked. Repository contributors can replace the global CLI with
`node /path/to/saycode-extensions/packages/sdk/dist/cli.js`.

The SDK is not publicly published during the v1 preview. To reproduce the complete Quick Start without a Desktop/core
checkout, build a tarball from this repository and use it for both the CLI and scaffolded dependency:

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

Public npm publication remains a separate approval. Replace the example repository and `/tmp` paths with local paths;
do not commit the generated tarball.

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

## Versioning and compatibility

Use semantic versions for extension releases. `apiVersion` is the wire schema version and changes only for incompatible
contract changes. `engines.saycode` states the compatible Desktop line. The release gate tests the current and previous
supported API fixtures; unsupported versions must fail with an explanatory message. Do not deep-import SDK internals to
avoid that gate.

## Packaging and release

`saycode-extension pack .` validates the manifest, creates a browser ESM bundle, and writes a deterministic package
shape containing `extension.json` and `index.js`. A Git tag matching `v*` runs all tests, packages the official fixture,
generates SHA-256 metadata, and attaches both files to a GitHub release. Public npm publication, marketplace listing,
automatic update, artifact signing, and revocation are separate approvals and are not performed by this workflow.

## Security rules

- Never request or log credentials, cookies, encryption keys, or raw authorization headers.
- Never hide a required permission behind a generic label.
- Treat command arguments, panel messages, stored values, and remote content as untrusted input.
- Do not add postinstall scripts, symlinks, absolute paths, path traversal, dynamic Node imports, or native binaries.
- Keep network, file, machine, notification, and storage operations behind the smallest declared capability.
- Report a suspected sandbox or capability bypass privately using [SECURITY.md](../SECURITY.md).
