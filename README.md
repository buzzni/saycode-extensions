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

During the v1 preview the SDK is not published to a public registry. Contributors to this repository can use the
workspace CLI instead:

```bash
npm ci
npm run build
node packages/sdk/dist/cli.js scaffold /tmp/my-extension --id com.example.my-extension
```

- [Install and manage extensions](docs/USER_GUIDE.md)
- [Developer guide](docs/DEVELOPMENT.md)
- [Security policy](SECURITY.md)

The `examples/hello-world` package is the smallest supported command extension. Existing Saycode features remain in
Desktop until a separate migration specification approves moving them.
