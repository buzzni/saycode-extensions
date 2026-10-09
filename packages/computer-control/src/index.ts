import { defineExtension, type JsonValue } from '@buzzni/saycode-extension-sdk'
import { prepareUnpackedChrome } from './chromeRecipe.js'
function request(value: JsonValue | undefined): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || typeof value.machineId !== 'string' || !value.machineId) throw new Error('INVALID_REQUEST')
  if (value.platform !== undefined && !['darwin', 'win32', 'linux'].includes(String(value.platform))) throw new Error('INVALID_PLATFORM')
  return value
}
function result(value: JsonValue): Record<string, JsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_RESPONSE')
  return value
}
function daemonIsRunning(output: string): boolean {
  const text = output.trim().toLowerCase()
  if (!text) return false
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    if (parsed.running === false || parsed.ready === false || parsed.state === 'stopped' || parsed.state === 'dead') return false
    if (parsed.running === true || parsed.ready === true || parsed.state === 'running' || parsed.state === 'ready' || parsed.state === 'active') return true
  } catch { /* status is also emitted as human-readable text by cua-driver */ }
  if (/\b(?:not|isn't|isnt|never)\s+running\b|\bstopped\b|\bdead\b|\bnot\s+found\b/.test(text)) return false
  return /\b(?:running|ready|started|active)\b/.test(text)
}
export default defineExtension({
  activate(context) {
    let active: { machineId: JsonValue; cancelled: boolean; remoteMayContinue: boolean; finished: Promise<void> } | null = null
    // The host treats a browser cancel as revoke; send it only while a browser setup call is actually in flight.
    let browserInFlight = 0
    const browser = async (action: string, args: JsonValue) => {
      browserInFlight++
      try { return await context.invokeCapability('localBrowser.setup', action, args) } finally { browserInFlight-- }
    }
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
      // Stop always ends the check; other failures are read as the state they leave behind.
      const passCancel = (error: unknown) => { if (error instanceof Error && error.message === 'cancelled') throw error }
      const windows = input.platform === 'win32'
      if (windows) {
        // Desktop's broker rejects when the driver exits non-zero: `status` exits 1 while the daemon is stopped.
        const running = async () => {
          try {
            const status = result(await context.invokeCapability('localTools.inspect', 'run', { ...input, operation: 'status', parameters: {} }))
            return status.state === 'succeeded' && typeof status.output === 'string' && daemonIsRunning(status.output)
          } catch (error) { passCancel(error); return false }
        }
        if (!await running()) {
          // `autostart enable` registers an elevated logon task and asks for administrator approval (UAC).
          // It reports on stderr, so judge it by `autostart status` rather than by its own result.
          await tool('run', { ...input, operation: 'autostartEnable', parameters: {} }, true).catch(passCancel)
          const registered = await tool('run', { ...input, operation: 'autostartStatus', parameters: {} }).catch(error => { passCancel(error); return null })
          if (typeof registered?.output !== 'string' || !/^registered\b/.test(registered.output.trim().toLowerCase())) throw new Error('DRIVER_AUTOSTART_REQUIRED')
          await tool('run', { ...input, operation: 'autostartKick', parameters: {} }, true).catch(passCancel)
          let started = false
          for (let attempt = 0; attempt < 6 && !started; attempt++) {
            if (attempt) await new Promise(resolve => setTimeout(resolve, 1000))
            started = await running()
          }
          if (!started) throw new Error('LOCAL_DAEMON_REQUIRED')
        }
        const doctor = JSON.parse(await run('doctor'))
        return { version: 1, state: doctor.ok === true ? 'ready' : 'daemon-required' }
      }
      // macOS: grants belong to the CuaDriver daemon's own identity, which nothing else starts on a fresh
      // machine. `permissions grant` launches it through LaunchServices and asks macOS for what is missing.
      const granted = (status: Record<string, unknown>) => status.accessibility === true && status.screen_recording === true
      // Stop always ends the check; any other failure (no `permissions` command, non-JSON, unreachable) is just no reading.
      const reading = async (): Promise<Record<string, unknown> | null> => {
        try {
          const value: unknown = JSON.parse(await run('permissionStatus'))
          return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
        } catch (error) { passCancel(error); return null }
      }
      const macStatus = await reading()
      if (macStatus) {
        if (granted(macStatus)) return { version: 1, state: 'ready' }
        await run('grant').catch(passCancel) // pending approval or timeout: the status below decides
        const after = await reading()
        return { version: 1, state: after && granted(after) ? 'ready' : 'permissions-required' }
      }
      const doctor = JSON.parse(await run('doctor'))
      const permissions = JSON.parse(await run('permissions'))
      if (doctor.ok !== true || permissions.isError === true) return { version: 1, state: 'permissions-required' }
      const row = permissions.structuredContent ?? permissions
      return { version: 1, state: row.accessibility === true && row.screen_recording === true ? 'ready' : 'permissions-required' }
    })
    context.commands.register('buzzni.computer-control.automate', async args => {
      const input = request(args)
      if (active) throw new Error('BUSY')
      let finish!: () => void
      const work = { machineId: input.machineId!, cancelled: false, remoteMayContinue: false, finished: new Promise<void>(resolve => { finish = resolve }) }
      active = work
      let outcome: Record<string, JsonValue>
      try {
        const metadata = result(await browser('management', input))
        if (typeof metadata.extensionDirectory !== 'string' || !metadata.extensionDirectory) throw new Error('INVALID_RESPONSE')
        const handoff = result(await prepareUnpackedChrome(async (operation, parameters = {}) => {
          if (work.cancelled) throw new Error('CANCELLED')
          const response = await tool('run', { version: 1, machineId: input.machineId!, operation, parameters }, true)
          if (work.cancelled) throw new Error('CANCELLED')
          if (typeof response.output !== 'string') throw new Error('DRIVER_EXECUTION_FAILED')
          const parsed = JSON.parse(response.output)
          if (parsed.isError === true || parsed.ok === false || (parsed.effect === 'unverifiable' && operation !== 'click') || parsed.suspected_noop === true) throw new Error('DRIVER_MANUAL_REQUIRED')
          return result(parsed.structuredContent ?? parsed)
        }))
        outcome = { ...metadata, ...handoff }
        if (work.cancelled) throw new Error('CANCELLED')
      } finally {
        try {
          const cleanup = await tool('cancel', { version: 1, machineId: input.machineId! }, true)
          work.remoteMayContinue = cleanup.remoteMayContinue === true
        } catch { work.remoteMayContinue = true }
        finally { if (active === work) active = null; finish() }
      }
      if (work.cancelled) throw new Error('CANCELLED')
      return { ...outcome, remoteMayContinue: work.remoteMayContinue }
    })
    context.commands.register('buzzni.computer-control.cancel', async args => {
      const input = request(args), work = active
      if (work && work.machineId !== input.machineId) throw new Error('NOT_OWNED')
      if (work) work.cancelled = true
      const local = await tool('cancel', { version: 1, machineId: input.machineId! }, true).catch(() => ({ remoteMayContinue: true }))
      try { if (browserInFlight > 0) await context.invokeCapability('localBrowser.setup', 'cancel', { version: 1, machineId: input.machineId! }) }
      finally { await work?.finished }
      return { version: 1, state: 'cancelled', remoteMayContinue: local.remoteMayContinue === true || work?.remoteMayContinue === true }
    })
  },
})
