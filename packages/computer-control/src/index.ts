import { defineExtension, type JsonValue } from '@buzzni/saycode-extension-sdk'
import { prepareUnpackedChrome } from './chromeRecipe.js'
function request(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.machineId !== 'string' || !value.machineId) throw new Error('INVALID_REQUEST')
  return value
}
function result(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE')
  return value
}
export default defineExtension({
  activate(context) {
    let active: JsonValue | null = null
    const browser = (action: string, args: JsonValue) => context.invokeCapability('localBrowser.setup', action, args)
    const tool = async (action: string, args: JsonValue, control = false) => {
      const response = result(await context.invokeCapability(action === 'install' ? 'localTools.install' : control ? 'localTools.control' : 'localTools.inspect', action, args))
      if ((response.state === 'cancelled' && action !== 'cancel') || response.state === 'unsupported-platform') throw new Error(String(response.state))
      return response
    }
    context.commands.register('buzzni.computer-control.open', () => null)
    for (const action of ['profiles', 'management', 'pair', 'status', 'revoke']) context.commands.register('buzzni.computer-control.' + action, args => browser(action, request(args)))
    for (const action of ['inspect', 'install']) context.commands.register('buzzni.computer-control.' + action, args => tool(action, request(args)))
    context.commands.register('buzzni.computer-control.doctor', async args => {
      const input = request(args)
      const run = async (operation: string) => {
        const response = await tool('run', { ...input, operation, parameters: {} })
        if (response.state !== 'succeeded' || typeof response.output !== 'string') throw new Error('DRIVER_CHECK_FAILED')
        return response.output
      }
      const version = await run('version')
      if (!version.includes('0.32.0')) throw new Error('DRIVER_VERSION_MISMATCH')
      const doctor = JSON.parse(await run('doctor'))
      const permissions = JSON.parse(await run('permissions'))
      if (doctor.ok !== true || permissions.isError === true) return { version: 1, state: 'permissions-required' }
      const row = permissions.structuredContent ?? permissions
      return { version: 1, state: row.accessibility === true && row.screen_recording === true ? 'ready' : 'permissions-required' }
    })
    context.commands.register('buzzni.computer-control.automate', async args => {
      const input = request(args)
      if (active) throw new Error('BUSY')
      active = input
      try {
        const metadata = result(await browser('management', input))
        if (typeof metadata.extensionDirectory !== 'string' || !metadata.extensionDirectory) throw new Error('INVALID_RESPONSE')
        const handoff = result(await prepareUnpackedChrome(async (operation, parameters = {}) => {
          if (active !== input) throw new Error('CANCELLED')
          const response = await tool('run', { version: 1, machineId: input.machineId!, operation, parameters }, true)
          if (typeof response.output !== 'string') throw new Error('DRIVER_EXECUTION_FAILED')
          const parsed = JSON.parse(response.output)
          if (parsed.isError === true || parsed.ok === false || (parsed.effect === 'unverifiable' && operation !== 'click') || parsed.suspected_noop === true) throw new Error('DRIVER_MANUAL_REQUIRED')
          return result(parsed.structuredContent ?? parsed)
        }))
        return { ...metadata, ...handoff }
      } finally {
        active = null
        await tool('cancel', { version: 1, machineId: input.machineId! }, true)
      }
    })
    context.commands.register('buzzni.computer-control.cancel', async args => {
      const input = request(args); active = null
      const local = await tool('cancel', { version: 1, machineId: input.machineId! }, true).catch(() => ({ remoteMayContinue: true }))
      await browser('cancel', { version: 1, machineId: input.machineId! })
      return { version: 1, state: 'cancelled', remoteMayContinue: local.remoteMayContinue ?? false }
    })
  },
})
