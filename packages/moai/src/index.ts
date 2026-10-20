import { defineExtension, machineRun, MachineRunError, type ExtensionContext, type JsonValue, type MachineRunStartRequest } from '@buzzni/saycode-extension-sdk'

const extensionId = 'buzzni.moai'

/** Reads that take no value. `read-all` writes only the user's own `~/.config/moai/read`, never the tracker. */
const withoutValue = new Set([
  'buzzni.moai.status',
  'buzzni.moai.prime',
  'buzzni.moai.show-all',
  'buzzni.moai.backlog-all',
  'buzzni.moai.show-archived',
  'buzzni.moai.wiki-ls',
  'buzzni.moai.read-all',
  'buzzni.moai.skill-status',
  'buzzni.moai.show-all-worktree',
  // A write: plants the optional `moai-saycode` skill in the project (writeScope `project`); Desktop asks each time.
  'buzzni.moai.skill-install-saycode',
  // A write: puts a `.moai/` into a project that has none (writeScope `project`); Desktop asks each time.
  'buzzni.moai.init',
])

/**
 * Profiles that take one non-empty string, by the parameter name the manifest declares. The value lands in
 * argv as its own word after a subcommand, so one that starts with `-` would be read as a flag (`read --all`
 * from a `read <id>` call): such a value is refused.
 */
const withValue = new Map([
  ['buzzni.moai.show', 'id'],
  ['buzzni.moai.show-worktree', 'id'],
  ['buzzni.moai.wiki-show', 'slug'],
  ['buzzni.moai.read', 'id'],
  ['buzzni.moai.read-group', 'group'],
  ['buzzni.moai.show-archived-after', 'after'],
])

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
      if (typeof profileId !== 'string') throw new Error('unsupported Moai profile')
      if (withoutValue.has(profileId)) {
        if (value !== undefined) throw new Error(`${profileId} takes no value`)
        return start(context, { action: 'start', profileId, parameters: {} })
      }
      const parameter = withValue.get(profileId)
      if (parameter) {
        if (typeof value !== 'string' || value.length === 0) throw new Error(`${parameter} is required`)
        if (value.startsWith('-')) throw new Error(`${parameter} cannot start with "-"`)
        return start(context, { action: 'start', profileId, parameters: { [parameter]: value } })
      }
      // The panel reads only: the tracker's one write, `add`, is not declared (se-24ey.oxd).
      throw new Error('unsupported Moai profile')
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
