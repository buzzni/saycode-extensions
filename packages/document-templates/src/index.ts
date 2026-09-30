import { defineExtension, type JsonValue, type ExtensionPermission } from '@buzzni/saycode-extension-sdk'
import { catalog } from './catalog.js'
const permissions = new Set(['assets.read', 'assets.write', 'files.select', 'drafts.prepare'])
export default defineExtension({
  activate(context) {
    context.commands.register('buzzni.document-templates.open', () => null)
    context.commands.register('buzzni.document-templates.execute', async (input) => {
      if (input === 'catalog') return catalog.map(row => ({ ...row }))
      try {
        if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('INVALID_REQUEST')
        const { permission, action, args } = input
        if (typeof permission !== 'string' || !permissions.has(permission) || typeof action !== 'string'
          || !args || typeof args !== 'object' || Array.isArray(args)) throw new Error('INVALID_REQUEST')
        return { ok: true, value: await context.invokeCapability(permission as ExtensionPermission, action, { ...args, version: 1 }) }
      } catch (error) {
        const message = error instanceof Error ? error.message : ''
        const code = /\b(AUTH_CHANGED|PERMISSION_DENIED|REVISION_CONFLICT|TARGET_CHANGED|NOT_FOUND|SIZE_LIMIT|CANCELLED|TIMEOUT|INVALID_REQUEST|UNSUPPORTED_FORMAT)\b/.exec(message)?.[1] ?? 'SERVICE_UNAVAILABLE'
        return { ok: false, error: code } as JsonValue
      }
    })
  },
})
