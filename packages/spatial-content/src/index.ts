import { defineExtension } from '@buzzni/saycode-extension-sdk'

export default defineExtension({
  activate(context) {
    context.commands.register('buzzni.spatial-content.open', () => null)
  },
})
