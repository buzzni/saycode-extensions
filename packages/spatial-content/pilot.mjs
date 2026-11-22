import { Camera, Mesh, Plane, Program, Renderer, Transform, Vec3 } from 'ogl'
import { readPilotModel } from './pilot-model.mjs'

const pilot = document.querySelector('#spatial-pilot')
const editor = document.querySelector('#spatial-editor')
const enter = document.querySelector('#open-spatial-pilot')
const exit = pilot.querySelector('#close-spatial-pilot')
const input = pilot.querySelector('input')
const selectMotion = pilot.querySelector('select')
const status = pilot.querySelector('[role=status]')
const viewport = pilot.querySelector('.pilot-viewport')
const sceneControls = pilot.querySelector('.pilot-scene')
const placements = { desk: [-.62, -4.65], aisle: [.82, -5.15] }
const keyMoves = { w: [1, 0], a: [0, -1], s: [-1, 0], d: [0, 1] }
const modes = [...pilot.querySelectorAll('[data-pilot-mode]')]
const placementButtons = [...pilot.querySelectorAll('[data-pilot-place]')]
let view
let pending
let source
let verifiedSample

function setStatus(message, error = false) {
  status.textContent = message
  status.classList.toggle('error', error)
}

function setMode(mode) {
  for (const button of modes) button.setAttribute('aria-pressed', String(button.dataset.pilotMode === mode))
  for (const controls of pilot.querySelectorAll('[data-pilot-controls]')) {
    controls.hidden = controls.dataset.pilotControls !== mode
  }
  view.setMode(mode)
}

enter.addEventListener('click', () => {
  editor.hidden = true
  pilot.hidden = false
  exit.focus()
  view?.start()
  if (window.saycodePanel && source !== 'sample' && !pending) {
    void loadLobby(loadPackagedSample, 'sample')
  }
})
exit.addEventListener('click', () => {
  view?.pause()
  pilot.hidden = true
  editor.hidden = false
  enter.focus()
})
pilot.querySelector('#pick-spatial-pilot').addEventListener('click', () => input.click())
input.addEventListener('change', () => {
  const file = input.files[0]
  input.value = ''
  if (file) void loadLobby(() => file, 'file')
})

async function loadLobby(readFile, nextSource) {
  const attempt = Symbol()
  pending = attempt
  setStatus('3D 로비를 여는 중…')
  try {
    const file = await readFile()
    if (pending !== attempt) return
    const next = await openLobby(file, viewport)
    if (pending !== attempt) return next.dispose()
    view?.dispose()
    view = next
    source = nextSource
    viewport.replaceChildren(next.canvas)
    sceneControls.hidden = false
    setMode('visit')
    selectMotion.value = 'Idle'
    for (const button of placementButtons) button.setAttribute('aria-pressed', String(button.dataset.pilotPlace === 'desk'))
    if (!pilot.hidden) view.start()
    setStatus('로비를 열었어요. 이동 버튼이나 W·A·S·D로 걷고, 화면을 끌어 둘러보세요.')
  } catch (error) {
    if (pending === attempt) setStatus(error.message, true)
  } finally {
    if (pending === attempt) pending = undefined
  }
}

async function loadPackagedSample() {
  if (verifiedSample) return verifiedSample
  const command = 'buzzni.spatial-content.read-sample'
  try {
    const { bytes, chunkBytes } = await window.saycodePanel.invokeCommand(command, [null])
    if (
      !Number.isSafeInteger(bytes) || bytes < 28 || bytes > 5 * 1024 * 1024
      || !Number.isSafeInteger(chunkBytes) || chunkBytes < 16 * 1024 || chunkBytes > 24 * 1024
    ) throw new Error()
    const model = new Uint8Array(bytes)
    const count = Math.ceil(bytes / chunkBytes)
    const workers = Math.min(4, count)
    await Promise.all(Array.from({ length: workers }, async (_, worker) => {
      for (let index = worker; index < count; index += workers) {
        const text = atob(await window.saycodePanel.invokeCommand(command, [index]))
        const offset = index * chunkBytes
        if (text.length !== Math.min(chunkBytes, bytes - offset)) throw new Error()
        model.set(Uint8Array.from(text, byte => byte.charCodeAt(0)), offset)
      }
    }))
    verifiedSample = new File([model], 'photoreal-lobby-pilot.glb', { type: 'model/gltf-binary' })
    return verifiedSample
  } catch {
    throw new Error('내장 샘플을 열지 못했어요. 편집기로 돌아가 다시 시도해 주세요.')
  }
}

for (const button of modes) button.addEventListener('click', () => {
  setMode(button.dataset.pilotMode)
  setStatus(button.dataset.pilotMode === 'visit' ? '안내 직원에게 다가가 보세요.' : '직원의 위치·방향과 동작을 고르세요.')
})
for (const button of placementButtons) button.addEventListener('click', () => {
  view.place(button.dataset.pilotPlace)
  for (const item of placementButtons) item.setAttribute('aria-pressed', String(item === button))
  setStatus('직원을 ' + button.textContent + '에 배치했어요.')
})
for (const button of pilot.querySelectorAll('[data-pilot-move]')) {
  button.addEventListener('click', () => view.move(...keyMoves[button.dataset.pilotMove]))
}
for (const button of pilot.querySelectorAll('[data-pilot-turn]')) {
  button.addEventListener('click', () => view.turn(Number(button.dataset.pilotTurn) * .13))
}
pilot.querySelector('#rotate-spatial-staff').addEventListener('click', () => {
  view.rotateStaff()
  setStatus('직원이 바라보는 방향을 바꿨어요.')
})
pilot.querySelector('#greet-spatial-staff').addEventListener('click', () => {
  if (!view.canTalk()) {
    setStatus('안내 직원에게 조금 더 가까이 이동하세요.')
    return
  }
  view.greet()
  setStatus('안내 직원 · 안녕하세요. 방문 목적을 확인한 뒤 출입증을 받아 주세요.')
})
selectMotion.addEventListener('change', () => {
  view.playMotion(selectMotion.value)
  setStatus(selectMotion.selectedOptions[0].textContent + ' 동작을 재생해요.')
})
pilot.addEventListener('keydown', event => {
  const movement = keyMoves[event.key.toLowerCase()]
  if (!view?.isVisiting() || !movement || event.altKey || event.ctrlKey || event.metaKey) return
  event.preventDefault()
  view.move(...movement)
})

async function openLobby(file, viewport) {
  const canvas = document.createElement('canvas')
  canvas.setAttribute('role', 'img')
  canvas.setAttribute('aria-label', '3D 로비')
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (!context) throw new Error('이 앱에서 WebGL 2를 열 수 없어요.')
  const renderer = new Renderer({ canvas, dpr: Math.min(window.devicePixelRatio, 1.75), antialias: true, alpha: false })
  const { gl } = renderer
  const scene = new Transform()
  const camera = new Camera(gl, { near: .055, far: 40, fov: 56 })
  let model
  try {
    model = await readPilotModel(file, gl)
  } catch (error) {
    gl.getExtension('WEBGL_lose_context')?.loseContext()
    throw error
  }
  const { lobby, character, motions } = model
  lobby.setParent(scene)
  character.setParent(scene)
  const contact = new Mesh(gl, {
    geometry: new Plane(gl, { width: .72, height: .44 }),
    program: new Program(gl, {
      transparent: true,
      depthWrite: false,
      cullFace: null,
      vertex: `
        attribute vec3 position;
        attribute vec2 uv;
        uniform mat4 modelViewMatrix, projectionMatrix;
        varying vec2 surfaceUV;
        void main() {
          surfaceUV = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragment: `
        precision mediump float;
        varying vec2 surfaceUV;
        void main() {
          float shade = 1.0 - smoothstep(.12, .5, length(surfaceUV - .5));
          gl_FragColor = vec4(.12, .09, .07, shade * .36);
        }`,
    }),
  })
  contact.rotation.x = -Math.PI / 2
  contact.position.y = .025
  contact.setParent(character)
  gl.clearColor(.46, .44, .4, 1)

  let mode = 'visit'
  let playerX = 0
  let playerZ = 0
  let yaw = 0
  let pitch = 0
  let frame = 0
  let animation = motions.Idle
  let animationStart = 0
  let pointer
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)')
  const target = new Vec3()
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))

  function place(name) {
    const [x, z] = placements[name]
    character.position.set(x, 0, z)
  }
  place('desk')

  function resize() {
    if (!viewport.clientWidth || !viewport.clientHeight) return
    renderer.setSize(viewport.clientWidth, viewport.clientHeight)
    const aspect = viewport.clientWidth / viewport.clientHeight
    camera.perspective({ aspect, fov: mode === 'visit' ? Math.min(62, 52 / Math.min(1, aspect)) : 45 })
  }

  function draw(now) {
    if (mode === 'place') {
      camera.position.set(character.position.x, 1.24, character.position.z + 2.85)
      camera.lookAt(target.set(character.position.x, .93, character.position.z))
    } else {
      camera.position.set(playerX, 1.52, playerZ)
      camera.rotation.set(pitch, -yaw, 0)
    }
    const elapsed = (now - animationStart) / 1000
    animation.elapsed = animation === motions.Idle && motionPreference.matches ? 0 : elapsed
    animation.update(1, true)
    if (animation === motions.Greet && elapsed >= animation.duration) {
      animation = motions.Idle
      animationStart = now
    }
    renderer.render({ scene, camera, frustumCull: false })
    frame = requestAnimationFrame(draw)
  }

  function pause() {
    cancelAnimationFrame(frame)
    frame = 0
    observer.disconnect()
  }

  function turn(delta) {
    yaw = clamp(yaw + delta, -.37, .37)
  }

  const observer = new ResizeObserver(resize)
  canvas.addEventListener('pointerdown', event => {
    if (mode !== 'visit' || event.button !== 0) return
    pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    if (mode !== 'visit' || pointer?.id !== event.pointerId || !canvas.hasPointerCapture(event.pointerId)) return
    turn((event.clientX - pointer.x) * .004)
    pitch = clamp(pitch - (event.clientY - pointer.y) * .004, -.18, .14)
    pointer.x = event.clientX
    pointer.y = event.clientY
  })
  canvas.addEventListener('lostpointercapture', () => { pointer = undefined })

  return {
    canvas, place, turn, pause,
    start() {
      if (frame) return
      resize()
      observer.observe(viewport)
      animationStart = performance.now()
      frame = requestAnimationFrame(draw)
    },
    dispose() {
      pause()
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
    setMode(next) {
      mode = next
      resize()
    },
    isVisiting: () => mode === 'visit',
    move(forward, side) {
      const nextX = clamp(playerX + (forward * Math.sin(yaw) + side * Math.cos(yaw)) * .26, -1.05, 1.1)
      const nextZ = clamp(playerZ + (side * Math.sin(yaw) - forward * Math.cos(yaw)) * .26, -4.15, 0)
      if (Math.hypot(nextX - character.position.x, nextZ - character.position.z) >= .62) {
        playerX = nextX
        playerZ = nextZ
      }
    },
    rotateStaff() { character.rotation.y += Math.PI / 6 },
    canTalk: () => Math.hypot(playerX - character.position.x, playerZ - character.position.z) <= 2.1,
    greet() {
      character.rotation.y = Math.atan2(playerX - character.position.x, playerZ - character.position.z)
      this.playMotion('Greet')
    },
    playMotion(name) {
      animation = motions[name]
      animation.loop = name !== 'Greet'
      animationStart = performance.now()
    },
  }
}
