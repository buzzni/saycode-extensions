# Saycode Extensions

Official SDK, developer tools, and first-party extensions for Saycode Desktop.
Extensions run in an isolated browser sandbox and communicate with Desktop only through versioned, JSON-only APIs.

## Quick start

Requirements: Node.js 22 and npm 10 or later.

```bash
npm install --global @buzzni/saycode-extension-sdk
saycode-extension scaffold my-extension --id com.example.my-extension
cd my-extension
npm install
npm run validate
npm run pack
```

During the v1 preview the SDK is not published to a public registry. Contributors can build one local SDK tarball,
use its CLI to scaffold into a separate directory, and install that same tarball instead:

```bash
npm ci
npm run build
mkdir -p .artifacts
npm pack --workspace @buzzni/saycode-extension-sdk --pack-destination .artifacts
node packages/sdk/dist/cli.js scaffold /tmp/my-extension --id com.example.my-extension
cd /tmp/my-extension
npm install /path/to/saycode-extensions/.artifacts/buzzni-saycode-extension-sdk-0.1.0.tgz
npm run validate
npm run dev -- --once
npm run pack
```

This preview path does not require a Saycode Desktop/core checkout and does not imply public npm publication.

- [Install and manage extensions](docs/USER_GUIDE.md)
- [Developer guide](docs/DEVELOPMENT.md)
- [Security policy](SECURITY.md)

The `examples/hello-world` package is the smallest supported command extension. Existing Saycode features remain in
Desktop until a separate migration specification approves moving them.

## First-party extensions

`packages/project-templates` owns the official Dashboard, Survey Form, and API Backoffice starter metadata, localized
prompts, source assets, and content tests. Saycode Desktop ships a checksum-pinned release artifact but installs and
enables it only after the user confirms from the new-project **Templates** tab. See the
[user guide](docs/USER_GUIDE.md#official-project-templates) for lifecycle behavior and the
[developer guide](docs/DEVELOPMENT.md#first-party-project-templates) for package gates.
