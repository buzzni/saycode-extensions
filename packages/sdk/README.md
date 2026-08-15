# @buzzni/saycode-extension-sdk

Public, browser-compatible contracts for Saycode Extensions. Import only the package root or `/manifest`; Desktop
internals, Electron, Node built-ins, credentials, and unrestricted network/filesystem access are intentionally absent.

```ts
import { defineExtension } from '@buzzni/saycode-extension-sdk'

export default defineExtension({
  activate(context) {
    context.commands.register('com.example.hello', (name) => `Hello ${String(name)}`)
  },
})
```

See the repository [developer guide](../../docs/DEVELOPMENT.md) for the manifest, lifecycle, testing, and packaging
contracts. The package is preview-only and is not yet published to a public registry.
