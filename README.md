# Saycode Extensions

Official SDK, developer tools, and first-party extensions for Saycode Desktop.
Extensions run in an isolated browser sandbox and communicate with Desktop only through versioned, JSON-only APIs.

## Quick start

Requirements: Node.js 22 and npm 10 or later.

```bash
npx @buzzni/saycode-extension-sdk scaffold my-extension --id com.example.my-extension
cd my-extension
npm install
npm run validate
npm run dev -- --once
npm run pack
```

The SDK is published on npm as [`@buzzni/saycode-extension-sdk`](https://www.npmjs.com/package/@buzzni/saycode-extension-sdk).
Repository contributors can follow the local-SDK workflow in the developer guide when testing unreleased changes.

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
