import { defineExtension, machineRun } from '@buzzni/saycode-extension-sdk'

const extensionId = 'buzzni.moai'
const profiles = new Set(['buzzni.moai.status', 'buzzni.moai.add'])

export default defineExtension({
  activate(context) {
    // The machine action opens the board panel; the panel drives the commands below.
    context.commands.register(`${extensionId}.open`, () => null)
    context.commands.register(`${extensionId}.run`, (profileId, value) => {
      if (typeof profileId !== 'string' || !profiles.has(profileId)) throw new Error('unsupported Moai profile')
      if (profileId === 'buzzni.moai.status') {
        if (value !== undefined) throw new Error('status profile takes no value')
        return machineRun(context, { action: 'start', profileId, parameters: {} })
      }
      if (typeof value !== 'string') throw new Error('title is required')
      return machineRun(context, { action: 'start', profileId, parameters: { title: value } })
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
