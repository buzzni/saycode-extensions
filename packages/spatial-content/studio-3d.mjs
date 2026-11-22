import { loadPackagedSample, openLobby } from './pilot.mjs'
import { parseSceneSource, readSceneSource } from './pilot-model.mjs'
import { lobbyStory, readStudioStory, studioStory } from './studio-story.mjs'
import { availableGeneration, generateStudioSource } from './studio-generation.mjs'

const studio = document.getElementById('spatial-studio')
const legacy = document.getElementById('spatial-editor')
const get = selector => studio.querySelector(selector)
const all = selector => [...studio.querySelectorAll(selector)]
const setup = get('#spatial-setup')
const stage = get('#spatial-stage')
const start = get('#spatial-start')
const storyInput = get('#spatial-story-input')
const viewport = get('.pilot-viewport')
const staffTag = get('#spatial-staff-tag')
const status = get('#spatial-studio-status')
const walk = get('#spatial-walk')
const speech = get('#spatial-speech')
const choices = get('#spatial-choices')
const fields = all('[data-studio-field]')
const valuesAtStart = { position: 'desk', x: 0, z: 0, yaw: 0, height: 177, motion: 'Greet', light: 100, ...lobbyStory }
const positions = { desk: [-.62, -4.65], gate: [.7, -5.05] }
const moves = { forward: [1, 0], back: [-1, 0], left: [0, -1], right: [0, 1] }
const keyMoves = { w: 'forward', a: 'left', s: 'back', d: 'right', arrowup: 'forward', arrowleft: 'left', arrowdown: 'back', arrowright: 'right' }
const units = { x: ' cm', z: ' cm', yaw: '°', height: ' cm', light: '%' }
const sourceFiles = { room: null, person: null }
const sampleSources = Object.fromEntries(all('[data-source-name]').map(node => [node.dataset.sourceName, node.textContent]))
const pending = new Map()
const generations = new Map()
const changes = []
let sceneSources
let values = { ...valuesAtStart }
let view
let building = false
let edited = false
let storyChanged = false
let walking = false
let panel = 'placement'
let answer
let approached = false

window.addEventListener('saycode:panel-before-close', event => {
  if (edited || pending.size || building || storyChanged || sourceFiles.room || sourceFiles.person) event.preventDefault()
})

function notice(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}

function updateStart() {
  start.disabled = building || pending.size > 0
  const custom = sourceFiles.room || sourceFiles.person || storyInput.value.trim()
  const action = view ? '소스 변경 적용' : custom ? '첫 장면 만들기' : '실사 3D 샘플 열기'
  start.textContent = building ? '3D 장면을 여는 중…' : action
  get('#spatial-return').hidden = !view
}

function sourceNotice(part, message, error = false) {
  const element = get('[data-source-status="' + part + '"]')
  element.textContent = message
  element.classList.toggle('error', error)
  element.hidden = !message
}

async function importSource(part, file) {
  generations.get(part)?.abort()
  const token = Symbol(part)
  pending.set(part, token)
  updateStart()
  sourceNotice(part, '파일을 읽는 중…')
  try {
    const model = part === 'story' ? await readStudioStory(file) : await readSceneSource(file)
    if (pending.get(part) !== token) return
    setSource(part, model, file.name)
    sourceNotice(part, part === 'story' ? file.name + '을 불러왔어요.' : '')
  } catch (error) {
    if (pending.get(part) === token) sourceNotice(part, error.message, true)
  } finally {
    if (pending.get(part) === token) {
      pending.delete(part)
      updateStart()
    }
  }
}

function setSource(part, model, name) {
  if (part === 'story') {
    storyInput.value = [model.greeting, model.meeting, model.tour].join('\n').trimEnd()
    storyChanged = true
  } else {
    sourceFiles[part] = { model, name }
    get('[data-source-name="' + part + '"]').textContent = name
    get('[data-use-sample="' + part + '"]').hidden = false
  }
}

function showSetup(open) {
  setup.hidden = !open
  stage.hidden = open
  get('#spatial-sources').hidden = open
  notice('')
  if (open) {
    view?.pause()
    updateStart()
    get('#spatial-setup-heading').focus()
  } else {
    view.start()
    get('#spatial-scene-heading').focus()
  }
}

function showLegacy(open) {
  legacy.hidden = !open
  studio.hidden = open
  if (open) {
    view?.pause()
    legacy.querySelector('h1').tabIndex = -1
    legacy.querySelector('h1').focus()
  } else if (stage.hidden) {
    get('#spatial-setup-heading').focus()
  } else {
    view.start()
    get('#spatial-scene-heading').focus()
  }
}

function syncInspector(refreshFields = false) {
  get('#spatial-inspector-heading').textContent = panel === 'environment' ? '로비' : panel === 'dialogue' ? '방문 목적 확인' : '안내 직원'
  get('#spatial-edit-tabs').hidden = panel === 'environment'
  all('[data-edit-panel]').forEach(item => { item.hidden = item.dataset.editPanel !== panel })
  all('[data-source-panel]').forEach(button => {
    const page = button.dataset.sourcePanel
    button.setAttribute('aria-pressed', String(page === panel || (page === 'placement' && panel === 'motion')))
  })
  all('[data-inspect-panel]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.inspectPanel === panel)))
  all('[data-position]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.position === values.position)))
  if (refreshFields) for (const field of fields) field.value = values[field.dataset.studioField]
  for (const [key, unit] of Object.entries(units)) get('[data-studio-value="' + key + '"]').textContent = values[key] + unit
  get('#spatial-undo').disabled = walking || !changes.length
  const missingGreeting = !values.greeting.trim()
  get('#spatial-greeting-error').hidden = !missingGreeting
  get('#spatial-greeting').setAttribute('aria-invalid', String(missingGreeting))
  walk.disabled = !walking && missingGreeting
  const [x, z] = positions[values.position]
  view?.edit({ x: x + values.x / 100, z: z + values.z / 100, direction: values.yaw, height: values.height, light: values.light })
}

function selectPanel(next) {
  if (walking) setWalking(false)
  panel = next
  syncInspector()
}

function onFrame(marker) {
  const visible = !walking && panel !== 'environment' && Math.abs(marker.x) < .90 && Math.abs(marker.y) < .82 && marker.z >= -1 && marker.z < 1
  staffTag.hidden = !visible
  if (visible) {
    staffTag.style.left = (marker.x + 1) * 50 + '%'
    staffTag.style.top = (1 - marker.y) * 50 + '%'
  }
}

function remember(previous) {
  if (Object.keys(previous).every(key => previous[key] === values[key])) return
  changes.push(previous)
  edited = true
  syncInspector()
  notice('장면에 반영했어요.')
}

function updateVisit() {
  if (!walking) return
  const distance = view.distance()
  get('#spatial-distance').textContent = '안내 직원까지 ' + distance.toFixed(1) + ' m'
  if (distance > 2.05) {
    approached = false
    answer = undefined
  } else if (!approached) {
    approached = true
    view.play(values.motion)
  }
  const line = approached ? (answer ? values[answer] : values.greeting) : '직원에게 다가가 보세요.'
  if (speech.textContent !== line) speech.textContent = line
  choices.hidden = !approached || Boolean(answer) || (!values.meeting.trim() && !values.tour.trim())
  all('[data-visit-answer]').forEach(button => { button.hidden = !values[button.dataset.visitAnswer].trim() })
}

function setWalking(active) {
  walking = active
  view.setWalking(active)
  walk.textContent = active ? '여기서 수정' : '걸어보기'
  get('#spatial-walk-controls').hidden = get('#spatial-visit').hidden = !active
  get('#spatial-edit').hidden = active
  get('#spatial-view-label').textContent = active ? '방향키로 이동 · 화면을 끌어 둘러보기' : '편집 중'
  if (active) {
    approached = false
    answer = undefined
  }
  notice('')
  syncInspector()
  updateVisit()
}

async function assemble() {
  if (building || pending.size) return
  let story
  try {
    story = storyInput.value.trim() ? studioStory(storyInput.value) : lobbyStory
  } catch (error) {
    sourceNotice('story', error.message, true)
    storyInput.focus()
    return
  }
  const firstScene = !view
  const applyStory = firstScene || storyChanged
  building = storyInput.disabled = true
  updateStart()
  get('#spatial-legacy').disabled = get('#spatial-return').disabled = true
  notice('3D 장면을 여는 중…')
  try {
    const room = sourceFiles.room?.model
    const person = sourceFiles.person?.model
    if (!view || sceneSources.room !== room || sceneSources.person !== person) {
      const sample = !room || !person ? await loadPackagedSample() : null
      const replacement = await openLobby({ sample, room, person }, viewport, onFrame)
      view?.dispose()
      view = replacement
      sceneSources = { room, person }
      viewport.replaceChildren(view.canvas)
      get('#spatial-scene-heading').textContent = sourceFiles.room?.name.replace(/\.glb$/i, '') || '보안 게이트 로비'
      const supported = new Set(view.motions)
      const motion = get('#spatial-motion')
      for (const option of motion.options) option.disabled = !supported.has(option.value)
      get('#spatial-motion-hint').hidden = supported.size === motion.options.length
      if (!supported.has(values.motion)) {
        values.motion = 'Idle'
        // The previous character's animation may not exist on this one.
        for (const change of changes) if (!supported.has(change.motion)) change.motion = 'Idle'
      }
    }
    if (applyStory) {
      const previous = { ...values }
      Object.assign(values, story)
      if (storyChanged && !firstScene) remember(previous)
    }
    storyChanged = false
    setWalking(false)
    syncInspector(true)
    showSetup(false)
  } catch (error) {
    notice(error.message || '3D 장면을 열지 못했어요. 파일을 확인하고 다시 시도해 주세요.', true)
  } finally {
    building = storyInput.disabled = false
    updateStart()
    get('#spatial-legacy').disabled = get('#spatial-return').disabled = false
  }
}

function move(direction) {
  if (!walking) return
  view.move(...moves[direction])
  updateVisit()
}

for (const button of all('[data-studio-pick]')) {
  const part = button.dataset.studioPick
  const input = get('[data-studio-file="' + part + '"]')
  button.addEventListener('click', () => { if (!building) input.click() })
  input.addEventListener('change', () => {
    const file = input.files[0]
    input.value = ''
    if (file && !building) void importSource(part, file)
  })
}
for (const button of all('[data-use-sample]')) {
  button.addEventListener('click', () => {
    if (building || pending.has(button.dataset.useSample)) return
    const part = button.dataset.useSample
    sourceFiles[part] = null
    get('[data-source-name="' + part + '"]').textContent = sampleSources[part]
    button.hidden = true
    sourceNotice(part, '')
    updateStart()
  })
}

storyInput.addEventListener('input', () => {
  generations.get('story')?.abort()
  pending.delete('story')
  storyChanged = true
  sourceNotice('story', '')
  updateStart()
})
get('#spatial-legacy').addEventListener('click', () => showLegacy(true))
legacy.querySelector('#open-spatial-studio').addEventListener('click', () => showLegacy(false))
get('#spatial-sources').addEventListener('click', () => {
  if (!storyChanged && edited) {
    storyInput.value = [values.greeting, values.meeting, values.tour].join('\n').trimEnd()
  }
  showSetup(true)
})
get('#spatial-return').addEventListener('click', () => showSetup(false))
start.addEventListener('click', () => void assemble())
walk.addEventListener('click', () => setWalking(!walking))
staffTag.addEventListener('click', () => selectPanel('placement'))
for (const button of all('[data-source-panel], [data-inspect-panel]')) {
  button.addEventListener('click', () => selectPanel(button.dataset.sourcePanel ?? button.dataset.inspectPanel))
}
for (const button of all('[data-position]')) {
  button.addEventListener('click', () => {
    const previous = { ...values }
    Object.assign(values, { position: button.dataset.position, x: 0, z: 0 })
    remember(previous)
  })
}
for (const field of fields) {
  const key = field.dataset.studioField
  let before
  field.addEventListener('input', () => {
    before ??= { ...values }
    values[key] = field.type === 'range' ? Number(field.value) : field.value
    syncInspector()
  })
  field.addEventListener('change', () => {
    if (before) remember(before)
    before = undefined
  })
}
get('#spatial-undo').addEventListener('click', () => {
  if (!changes.length) return
  values = changes.pop()
  syncInspector(true)
  notice('마지막 수정을 되돌렸어요.')
})
get('#spatial-motion-preview').addEventListener('click', () => {
  view.play(values.motion)
  notice(get('#spatial-motion').selectedOptions[0].textContent + ' 동작을 재생해요.')
})
all('[data-walk]').forEach(button => button.addEventListener('click', () => move(button.dataset.walk)))
all('[data-turn]').forEach(button => button.addEventListener('click', () => view.turn(Number(button.dataset.turn) * .13)))
get('#spatial-restart').addEventListener('click', () => {
  view.restart()
  updateVisit()
})
all('[data-visit-answer]').forEach(button => button.addEventListener('click', () => {
  answer = button.dataset.visitAnswer
  updateVisit()
}))
studio.addEventListener('keydown', event => {
  if (!walking || event.isComposing || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target.tagName) ||
      event.altKey || event.metaKey || event.ctrlKey) return
  const direction = keyMoves[event.key.toLowerCase()]
  if (!direction) return
  event.preventDefault()
  move(direction)
})
syncInspector(true)

const generationHint = {
  SERVICE_ACCESS: '생성 서비스 연결을 확인해 주세요.',
  SERVICE_CREDITS: '서비스 크레딧이 부족해요.',
  SERVICE_BUSY: '생성 서비스가 바빠요. 잠시 후 다시 시도해 주세요.',
  GENERATION_BUSY: '이미 생성 중인 작업이 있어요.',
  GENERATION_UNAVAILABLE: '생성 연결이나 확장 권한을 확인해 주세요.',
  RESULT_TOO_LARGE: '생성된 3D 파일이 이 앱에서 열 수 있는 크기를 넘었어요.',
}
const resultNames = { room: 'AI 생성 환경.glb', person: 'AI 생성 인물.glb', story: 'AI 생성 스토리' }

function bindGeneration(group, available) {
  const part = group.dataset.generation
  const prompt = group.querySelector('textarea')
  const button = group.querySelector('[data-generate]')
  const stop = group.querySelector('[data-stop-generation]')
  group.querySelector('[data-generation-unavailable]').hidden = available
  function sync() {
    const running = generations.has(part)
    button.disabled = !available || running || !prompt.value.trim()
    stop.hidden = !running
  }
  prompt.addEventListener('input', () => { edited = true; sync() })
  stop.addEventListener('click', () => generations.get(part)?.abort())
  button.addEventListener('click', async () => {
    if (building || pending.has(part)) return
    const controller = new AbortController()
    const token = Symbol(part)
    pending.set(part, token)
    generations.set(part, controller)
    sync()
    updateStart()
    sourceNotice(part, 'AI로 만드는 중…')
    try {
      const result = await generateStudioSource(part, prompt.value.trim(), controller.signal)
      const name = resultNames[part]
      const model = part === 'story' ? studioStory(result)
        : parseSceneSource(result)
      if (pending.get(part) !== token || controller.signal.aborted) return
      setSource(part, model, name)
      sourceNotice(part, '만들었어요. 첫 장면을 열면 이 결과가 반영돼요.')
    } catch (error) {
      if (pending.get(part) === token) {
        sourceNotice(part, controller.signal.aborted ? '결과 받기를 중지했어요.'
          : generationHint[error.message] ?? 'AI 결과를 가져오지 못했어요. 입력을 확인하고 다시 시도해 주세요.', !controller.signal.aborted)
      }
    } finally {
      if (pending.get(part) === token) pending.delete(part)
      generations.delete(part)
      updateStart()
      sync()
    }
  })
  sync()
}

function setupGeneration() {
  void availableGeneration().then(kinds => {
    for (const group of all('[data-generation]')) bindGeneration(group, kinds.includes(group.dataset.generation))
  })
}
if (window.saycodePanel) setupGeneration()
else window.addEventListener('saycode-panel-ready', setupGeneration, { once: true })
window.addEventListener('pagehide', () => {
  for (const controller of generations.values()) controller.abort()
})
