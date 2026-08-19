# @buzzni/saycode-extension-sdk

Contracts and CLI for building extensions for Saycode Desktop.

Extensions run in an isolated host, outside the Saycode renderer. This package gives you the typed contracts to write
one and the CLI to validate, bundle, and package it. Desktop internals, Electron, Node built-ins, credentials, and
unrestricted network/filesystem access are intentionally absent — the security boundary lives in Desktop, not here.

## Quick Start

`scaffold` needs no prior install — `npx` fetches the CLI for you:

```bash
npx @buzzni/saycode-extension-sdk scaffold hello-extension --id com.example.hello
cd hello-extension
npm install
npm run validate
npm run dev -- --once
npm run pack
```

The result is `com.example.hello-1.0.0.saycode-extension`, installable from **Settings → Extensions** in Saycode
Desktop. The scaffolded command is lazy: Desktop activates the extension only when `com.example.hello.hello` is first
invoked.

## Install

`scaffold` already adds the SDK to the generated project. To add it to an existing project:

```bash
npm i -D @buzzni/saycode-extension-sdk
```

Always a **devDependency**. `pack` inlines the contracts into your extension bundle, so nothing resolves this package
at runtime — and declaring it as a runtime dependency would drag the CLI's `esbuild` and `jszip` into your tree.

Requires Node.js 22 or newer.

## Public API

Only these imports are stable:

```ts
import { defineExtension, type ExtensionContext, type JsonValue } from '@buzzni/saycode-extension-sdk'
import { parseExtensionManifest } from '@buzzni/saycode-extension-sdk/manifest'
```

```ts
export default defineExtension({
  activate(context) {
    context.commands.register('com.example.hello.hello', (name) => `Hello ${String(name)}`)
  },
})
```

`defineExtension` accepts `activate(context)` and an optional `deactivate()`. `context.commands.register(id, handler)`
registers a namespaced command. Arguments and results must be JSON values: null, finite numbers, booleans, strings,
arrays, or plain objects composed from those values.

Importing undocumented package subpaths is rejected by package exports. Importing Saycode Desktop source,
`@buzzni/saycode-core`, Electron, VS Code, or Node built-ins is forbidden and fails at bundle time.

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
empty, `.`, or `..` segments. API versions and permissions are closed sets; an unknown value is rejected before
execution. Supported v1 contributions are `commands`, typed `settings`, isolated `panels`, and `projectTemplates`.

A project template keeps the v1 `id`, `title`, and `assetsRoot` fields and may add UI metadata:

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
      "ko": { "title": "대시보드", "description": "대시보드 시작점", "firstPrompt": "대시보드를 만들어줘" }
    }
  }]
}
```

`description`, `stack`, `firstPrompt`, and `devServerCommand` are optional for v1 compatibility, but Desktop lists only
templates that provide all four. `localizations` may override `title`, `description`, and `firstPrompt`; lookup falls
back from an exact locale to its base language and then to the default fields. Asset paths stay relative to
`assetsRoot`; Desktop reads them through bounded host APIs rather than exposing installation paths.

## Lifecycle and permissions

Installation validates and stores an extension but leaves it disabled. Enablement exposes contributions without loading
extension code. An activation event loads the browser bundle in the isolated host. Disablement removes contributions and
deactivates the host. Three consecutive crashes quarantine the extension until manual recovery. Updates require an
inactive extension and preserve the last-known-good version for rollback.

Protected work must go through a declared capability. Both a manifest declaration and current user approval are
required. Extensions never receive raw auth tokens, E2EE secrets, sync credentials, unrestricted Electron/Node objects,
or ambient filesystem, network, or process access.

## UI contributions

Extensions cannot import React components into the Saycode renderer. `panels` name a packaged HTML entrypoint rendered
in an isolated surface with origin and schema checks and no raw credential bridge. Settings and project templates are
declarative descriptors. Keep contribution ids namespaced by the extension id; collisions disable registration.

## Testing and debugging

`saycode-extension validate .` checks the manifest before you build. `saycode-extension dev . --once` produces a
deterministic browser bundle. The bundler targets a browser and deliberately fails imports such as `node:fs`,
`node:net`, `child_process`, or `electron`.

Runtime exceptions and timeouts appear in **Settings → Extensions** in Desktop; repeated crashes enter quarantine.

## Packaging and release

`saycode-extension pack .` validates the manifest, creates a browser ESM bundle, and writes a deterministic package
containing `extension.json` and `index.js`. Distribute that file directly; users install it from
**Settings → Extensions**.

A marketplace, remote catalog, automatic updates, artifact signing, and revocation are not part of this release.

## Versioning and compatibility

This package is `0.x`: minor versions may contain breaking changes while the extension API settles. Pin an exact
version if you need stability.

Use semantic versions for your own extension releases. `apiVersion` is the wire schema version and changes only for
incompatible contract changes. `engines.saycode` states the compatible Desktop line. Desktop tests the current and
previous supported API fixtures and rejects unsupported versions with an explanatory message. Do not deep-import SDK
internals to work around that gate.

## Security rules

- Never request or log credentials, cookies, encryption keys, or raw authorization headers.
- Never hide a required permission behind a generic label.
- Treat command arguments, panel messages, stored values, and remote content as untrusted input.
- Do not add postinstall scripts, symlinks, absolute paths, path traversal, dynamic Node imports, or native binaries.
- Keep network, file, machine, notification, and storage operations behind the smallest declared capability.
- Report a suspected sandbox or capability bypass privately, never in a public forum. Use
  https://github.com/buzzni/saycode-desktop-releases/security/advisories/new — any GitHub account can file there
  and only the Saycode maintainers see it. Include the affected SDK and API version, a minimal extension package,
  and reproduction steps without real credentials.

## License

MIT
