import type { JsonValue } from '@buzzni/saycode-extension-sdk'
type Invoke = (operation: string, parameters?: Record<string, JsonValue>) => Promise<Record<string, JsonValue>>
const LOAD = /^(Load unpacked|압축해제된 확장 프로그램을 로드합니다\.?|압축해제된 확장 프로그램 로드|パッケージ化されていない拡張機能を読み込む|加载已解压的扩展程序)$/i
const DEVELOPER = /^(Developer mode|개발자 모드|デベロッパー モード|开发者模式)$/i
function rows(value: JsonValue | undefined): Array<Record<string, JsonValue>> { return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Array<Record<string, JsonValue>> : [] }
/** Bounded AX recipe. Any ambiguous/unknown postcondition hands control back to the user. */
export async function prepareUnpackedChrome(invoke: Invoke): Promise<JsonValue> {
  const listed = await invoke('windows')
  const windows = rows(listed.windows).filter(window => window.app_name === 'Google Chrome' && /^(Extensions|확장 프로그램|拡張機能|扩展程序)/.test(String(window.title)))
  if (windows.length !== 1) return { version: 1, state: 'manual-required', reason: 'select-chrome-window' }
  const window = windows[0]!, target = { pid: window.pid!, windowId: window.window_id! }
  const snapshot = () => invoke('snapshot', target)
  let state = await snapshot()
  if (state.degraded_reason || state.truncated === true) return { version: 1, state: 'manual-required', reason: 'accessibility-unavailable' }
  const find = (expression: RegExp, roles: string[]) => rows(state.elements).filter(element => expression.test(String(element.label))
    && roles.includes(String(element.role)) && element.enabled !== false && Array.isArray(element.actions) && element.actions.includes('AXPress'))
  if (!find(LOAD, ['AXButton', 'Button']).length) {
    const toggles = find(DEVELOPER, ['AXCheckBox', 'AXSwitch', 'CheckBox', 'Switch'])
    if (toggles.length !== 1 || typeof toggles[0]!.element_token !== 'string') return { version: 1, state: 'manual-required', reason: 'developer-mode' }
    await invoke('click', { ...target, elementToken: toggles[0]!.element_token! })
    state = await snapshot()
  }
  const load = find(LOAD, ['AXButton', 'Button'])
  if (load.length !== 1 || typeof load[0]!.element_token !== 'string') return { version: 1, state: 'manual-required', reason: 'load-unpacked' }
  await invoke('click', { ...target, elementToken: load[0]!.element_token! })
  // Native file pickers can run in another process. Never type into an inferred window.
  // The user chooses the daemon-resolved directory; exact extension/profile status is proved by pairing.
  return { version: 1, state: 'manual-required', reason: 'choose-extension-directory' }
}
