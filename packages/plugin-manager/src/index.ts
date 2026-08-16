import { defineExtension, type JsonValue } from '@buzzni/saycode-extension-sdk'

interface MachinePlugin {
  id: string
  name: string
  marketplace: string
  version: string
  scope: string
  enabled: boolean
}

function pluginResponse(value: JsonValue): { plugins: MachinePlugin[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('plugin response must be an object')
  }
  const root = value as Record<string, JsonValue>
  if (Object.keys(root).join(',') !== 'plugins' || !Array.isArray(root.plugins)) {
    throw new Error('plugin response must contain only a plugins array')
  }
  const plugins = root.plugins.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`plugin response entry ${index} must be an object`)
    }
    const plugin = entry as Record<string, JsonValue>
    const keys = ['enabled', 'id', 'marketplace', 'name', 'scope', 'version']
    if (Object.keys(plugin).sort().join(',') !== keys.join(',')) {
      throw new Error(`plugin response entry ${index} has an invalid shape`)
    }
    for (const field of ['id', 'name', 'marketplace', 'version', 'scope'] as const) {
      if (typeof plugin[field] !== 'string') {
        throw new Error(`plugin response entry ${index} has an invalid ${field}`)
      }
    }
    if (typeof plugin.enabled !== 'boolean') {
      throw new Error(`plugin response entry ${index} has an invalid enabled flag`)
    }
    return plugin as unknown as MachinePlugin
  })
  return { plugins }
}

function pluginId(value: JsonValue | undefined): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._@/-]+$/.test(value)) {
    throw new Error('plugin id is invalid')
  }
  return value
}

export default defineExtension({
  activate(context) {
    const invoke = async (action: 'list' | 'enable' | 'disable', id?: JsonValue) =>
      pluginResponse(await context.invokeCapability(
        'machine.execute',
        action,
        action === 'list' ? {} : { pluginId: pluginId(id) },
      ))

    context.commands.register('buzzni.plugin-manager.open', () => null)
    context.commands.register('buzzni.plugin-manager.list', () => invoke('list'))
    context.commands.register('buzzni.plugin-manager.enable', (id) => invoke('enable', id))
    context.commands.register('buzzni.plugin-manager.disable', (id) => invoke('disable', id))
  },
})
