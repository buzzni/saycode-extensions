import { defineExtension, machineRun, MachineRunError, type ExtensionContext, type JsonValue, type MachineRunStartRequest } from '@buzzni/saycode-extension-sdk'

const extensionId = 'buzzni.moai'
/** Reads that take no value; `show` takes a task id and `add` a title. */
const readsWithoutValue = new Set(['buzzni.moai.status', 'buzzni.moai.prime'])
const profiles = new Set([...readsWithoutValue, 'buzzni.moai.show', 'buzzni.moai.add'])

/**
 * The panel bridge forwards only an error message, so a refusal Core explains with a code comes back as a
 * result the board can describe. Unknown failures still throw.
 */
async function start(context: ExtensionContext, request: MachineRunStartRequest): Promise<JsonValue> {
  try {
    return await machineRun(context, request)
  } catch (error) {
    if (error instanceof MachineRunError) return { action: 'start', state: 'refused', code: error.code }
    throw error
  }
}

export default defineExtension({
  activate(context) {
    // The project tool opens the board panel; the panel drives the commands below.
    context.commands.register(`${extensionId}.open`, () => null)
    context.commands.register(`${extensionId}.run`, (profileId, value) => {
      if (typeof profileId !== 'string' || !profiles.has(profileId)) throw new Error('unsupported Moai profile')
      if (readsWithoutValue.has(profileId)) {
        if (value !== undefined) throw new Error(`${profileId} takes no value`)
        return start(context, { action: 'start', profileId, parameters: {} })
      }
      if (profileId === 'buzzni.moai.show') {
        if (typeof value !== 'string' || value.length === 0) throw new Error('task id is required')
        return start(context, { action: 'start', profileId, parameters: { id: value } })
      }
      if (typeof value !== 'string') throw new Error('title is required')
      return start(context, { action: 'start', profileId, parameters: { title: value } })
    })
    context.commands.register(`${extensionId}.status`, (operationId) => {
      if (typeof operationId !== 'string' || operationId.length === 0) throw new Error('operation id is required')
      return machineRun(context, { action: 'status', operationId })
    })
    context.commands.register(`${extensionId}.cancel`, (operationId) => {
      if (typeof operationId !== 'string' || operationId.length === 0) throw new Error('operation id is required')
      return machineRun(context, { action: 'cancel', operationId })
    })
  },
})
