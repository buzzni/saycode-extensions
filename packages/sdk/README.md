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
  "apiVersion": 3,
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
execution. API v2 supports `commands`, typed `settings`, isolated `panels`, `projectTemplates`, and contextual
`machineActions`. API v3 additionally supports declarative `artifactActions`; the current SDK accepts only the
Desktop support window `[2,3]`.

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

`description`, `stack`, `firstPrompt`, and `devServerCommand` remain optional for compatibility, but Desktop lists only
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

A panel is one HTML file: Desktop allows only inline `<script>` and `<style>`, reads at most 512 KiB, and requires UTF-8.
Frameworks such as Svelte or Tailwind work when built into a single file (for example Vite with
`vite-plugin-singlefile`); run that build before `pack`. `saycode-extension pack` refuses a panel that references a
separate script or stylesheet, exceeds 512 KiB, or is not UTF-8, because Desktop would install it and render it blank.

### Panel title and size (panel size v1)

The host draws the panel's single title from `panels[].title`; do not render a second large heading (`<h1>`) inside the
panel. Start with a short description line or the content itself.

`panels[].surfaceSize` picks the host modal preset: `"compact"` (a small form or status view), `"standard"`, or
`"wide"` (tables, editors). Omit it to keep the host's default size. Any other value is rejected by `validate`/`pack`.
The host cannot measure a sandboxed iframe, so it does not size the modal to the content; choose the preset that fits
and let the panel scroll inside it.

```json
{ "panels": [{ "id": "com.example.hello.panel", "title": "Hello", "entrypoint": "panel.html", "surfaceSize": "compact" }] }
```

Older Desktop builds reject unknown panel fields, so a manifest that sets `surfaceSize` needs a Desktop with panel size v1.

### Panel theme (panel theme v1)

Desktop sets `<html data-theme="light|dark">` on the panel document and injects these CSS custom properties, updating
them in place when the app theme changes (the iframe is not reloaded):

| Variable | Meaning | Light fallback | Dark fallback |
|---|---|---|---|
| `--saycode-bg` | Panel background | `#FFFFFF` | `#13161A` |
| `--saycode-surface` | Raised or grouped area (chips, banners) | `#F4F4F5` | `#22252C` |
| `--saycode-text` | Body text | `#09090B` | `#FAFAFA` |
| `--saycode-text-muted` | Secondary text, labels | `#52525B` | `#A1A1AA` |
| `--saycode-border` | Control and divider borders | `#DCDCE0` | `#3E424D` |
| `--saycode-accent` | Brand color: primary buttons, focus ring, spinner | `#1B64DA` | `#2470E4` |
| `--saycode-accent-contrast` | Text on an accent fill | `#FFFFFF` | `#FFFFFF` |
| `--saycode-danger` | Errors and destructive actions | `#DC2626` | `#F87171` |
| `--saycode-radius` | Control corner radius | `10px` | `10px` |
| `--saycode-font` | Font stack | `system-ui, sans-serif` | `system-ui, sans-serif` |

Older Desktop builds inject neither, so always give a fallback and pick it from `prefers-color-scheme` unless
`data-theme` says otherwise. Resolve the variables where you use them (not once on `:root`), so they follow the host
wherever it sets them:

```css
:root { --fb-bg: #FFFFFF; --fb-text: #09090B; --fb-accent: #1B64DA; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fb-bg: #13161A; --fb-text: #FAFAFA; --fb-accent: #2470E4; } }
:root[data-theme="dark"] { --fb-bg: #13161A; --fb-text: #FAFAFA; --fb-accent: #2470E4; }
body { background: var(--saycode-bg, var(--fb-bg)); color: var(--saycode-text, var(--fb-text)); }
```

Panels never receive other host styles or values, and the CSP and sandbox stay as described above.

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
  https://github.com/buzzni/saycode-extensions/security/advisories/new — any GitHub account can file there
  and only the Saycode maintainers see it. Include the affected SDK and API version, a minimal extension package,
  and reproduction steps without real credentials.

## License

MIT

## Asset workflow (SDK 0.4.1 / host engine 1.1.0)

API 3 remains current, with API 2 still supported. New asset extensions declare `engines.saycode: "^1.1.0"`; older hosts fail closed. The CLI includes a package's optional `assets/` directory using the same traversal/symlink checks as project-template files. Do not put private user originals or credentials in an artifact.

The four permissions are separate grants: `assets.read` (list/describe/open/readChunk/close), `assets.write` (create/update/remove and begin/writeChunk/seal for instruction text), `files.select` (native pick/readChunk/close), and `drafts.prepare` (context/prepare/commit/cancel). Call `context.invokeCapability(permission, action, {version: 1, ...args})`. Core supplies the authenticated caller; no user ID, URL, credential, arbitrary machine command or absolute path is accepted. `assets.read/open` accepts either an artifact-relative `path`, or private `id`, `revision`, `role` (source/instructions/preview). `readChunk` accepts handle/offset and returns base64, nextOffset and done.

Originals are limited to 10 MiB each and 20 MiB per extension/principal scope. Chunks are 24 KiB, handles expire after 5 minutes of inactivity, and calls are bounded to 120 seconds. Editing uses contiguous byte offsets then a SHA-256 seal. Create takes name/sourceHandle/preserve; update takes id/expectedRevision and name/sourceHandle/instructionHandle; remove takes id/expectedRevision. Core shows a native confirmation and rechecks the revision. A failed or timed-out write may have reached the server: reload before retrying, never automatically repeat a create.

`context` returns targetId/revision/private for the composer that opened the panel. `prepare` takes targetId/revision/text/handles and returns preparationId. `commit` confirms then appends to that same unedited draft; it never sends a message or creates a session. Private originals cannot enter project or organizational drafts. Cancellation, navigation, account changes, permission revocation and host stop invalidate pending work. After applying, users review and send using the normal composer.

The panel must use `window.saycodePanel.ready` and `invokeCommand`, not install a competing MessagePort listener. It has no network or Node access. Renderer migration is outside this release: the document template package uses retained public previews and authenticated existing Web previews.

Panels run in an opaque-origin iframe framed with `sandbox="allow-scripts"`: forms never submit and `crypto.subtle` is unavailable. Save from button click handlers and hash in plain JavaScript; test panels in a harness that removes both.

## Managed local tools and browser setup (SDK 0.5.0)

`machineCommands` (API v3, paired with the `machine.run` permission) declares fixed remote command profiles: an executable name, an argv template with `{{workspaceRoot}}` and typed bounded `parameters`, a named cwd root, an environment allowlist, timeout and output limits, `stdin: "none"`, and for writes a `writeScope` plus a `descendantAllowlist`. Call `machineRun(context, { action: 'start', profileId, parameters })`, then `status`/`cancel` with the returned `operationId`. Core binds each run to the selected machine and project, asks the user at call time, and starts it only when the pinned Happy daemon ships a profile with the same digest; extension code never supplies a command, path or machine.

When Core refuses a run, `machineRun` rejects with a `MachineRunError` whose `code` is one of `MACHINE_RUN_ERROR_CODES`:

| Code | Meaning |
|---|---|
| `unsupported-daemon` | The machine's runtime is too old for `machine.run` or this profile |
| `invalid-request` | The request did not match the declared profile or parameters |
| `binding-mismatch` | The selected project or machine changed, or the call has no valid binding |
| `declined` | The user declined the confirmation |
| `approval-timeout` | The confirmation was not answered in time |
| `workspace-busy` | Another write to the same machine and folder is still running |
| `tool-missing` | The managed tool is not installed on that machine |
| `unsupported-platform` | The machine's operating system cannot run the tool |

The list is additive. An error with an unknown code (from a newer host) or no code (from an older host) is passed
through unchanged, so treat it as a generic failure.

```ts
try {
  await machineRun(context, { action: 'start', profileId, parameters })
} catch (error) {
  if (error instanceof MachineRunError && error.code === 'declined') return { state: 'refused', code: error.code }
  throw error
}
```

A panel cannot see these codes: the panel bridge carries only an error message. Return the code from your command
instead of throwing it, as the Moai extension does.

`managedLocalTool` declares exact HTTPS artifacts, archive/executable hashes, platform-specific signing checks and fixed argv operations with bounded typed JSON inputs. `localTools.inspect/install/control` are separate grants; installation never grants ongoing control. `localBrowser.setup` accepts profiles/management/pair/status/cancel/revoke and never accepts caller identity, viewerKey or tokens from extension code. Core resolves the local personal machine and authenticated caller. Cancellation reports remote uncertainty instead of promising that a shared native service stopped. `computer-control` owns the CUA metadata/recipe; Desktop owns admission, process lifetime and package smoke. These contracts require the matching unreleased host/Happy sources and are not a statement of current release availability.
