import { defineExtension } from '@buzzni/saycode-extension-sdk'

export default defineExtension({
  activate(context) {
    context.commands.register('buzzni.hello-world.hello', (name) => `Hello ${String(name ?? 'Saycode')}!`)
  },
})
