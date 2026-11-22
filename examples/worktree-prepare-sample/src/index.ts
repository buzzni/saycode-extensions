import { defineExtension } from '@buzzni/saycode-extension-sdk'

/**
 * Nothing runs here: Saycode itself copies the declared Git-ignored files from the original checkout into each new
 * worktree. With no activation event, this code is never even loaded for the hook.
 */
export default defineExtension({
  activate() {},
})
