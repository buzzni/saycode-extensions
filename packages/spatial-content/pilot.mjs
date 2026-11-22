import { Camera, Mesh, Plane, Program, Renderer, Transform, Vec3 } from 'ogl'
import { readPilotModel, readSceneSource } from './pilot-model.mjs'

let verifiedSample

export async function loadPackagedSample() {
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
    verifiedSample = await readSceneSource(new File([model], 'photoreal-lobby-pilot.glb'))
    return verifiedSample
  } catch {
    throw new Error('내장 샘플을 열지 못했어요. 편집기로 돌아가 다시 시도해 주세요.')
  }
}

export async function openLobby(sources, viewport, onFrame) {
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
    model = await readPilotModel(sources, gl)
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

  const motionByType = {
    Idle: findMotion(/idle|stand/i),
    Walk: findMotion(/walk/i),
    Greet: findMotion(/greet|wave|hello/i),
  }
  function findMotion(pattern) {
    return Object.entries(motions).find(([name]) => pattern.test(name))?.[1]
  }
  const animatedNodes = new Set(Object.values(motions).flatMap(animation => animation.data.map(({ node }) => node)))
  const restPose = [...animatedNodes].map(node => ({
    node, position: [...node.position], rotation: [...node.quaternion], scale: [...node.scale],
  }))
  const pose = { x: 0, z: 0, yaw: 0, pitch: 0 }
  const anchor = { x: -.62, z: -4.65 }
  const marker = new Vec3()
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value))
  let frame = 0
  let walking = false
  let animation = motionByType.Idle
  let motion = 'Idle'
  let animationStart = 0
  let pointer

  function resize() {
    if (!viewport.clientWidth || !viewport.clientHeight) return
    renderer.setSize(viewport.clientWidth, viewport.clientHeight)
    const aspect = viewport.clientWidth / viewport.clientHeight
    camera.perspective({ aspect, fov: Math.min(62, 52 / Math.min(1, aspect)) })
  }

  function play(name) {
    for (const { node, position, rotation, scale } of restPose) {
      node.position.copy(position)
      node.quaternion.copy(rotation)
      node.scale.copy(scale)
    }
    animation = motionByType[name]
    motion = name
    if (animation) animation.loop = name === 'Idle'
    animationStart = performance.now()
  }

  function draw(now) {
    camera.position.set(pose.x, 1.52, pose.z)
    camera.rotation.set(pose.pitch, -pose.yaw, 0)
    const elapsed = (now - animationStart) / 1000
    if (animation) {
      animation.elapsed = motion === 'Idle' && reduced.matches ? 0 : elapsed
      animation.update(1, true)
      if (motion !== 'Idle' && elapsed >= animation.duration) play('Idle')
    }
    const step = motion === 'Walk' && animation ? .3 * Math.sin(Math.PI * Math.min(1, elapsed / animation.duration)) : 0
    character.position.set(anchor.x, 0, anchor.z + step)
    renderer.render({ scene, camera, frustumCull: false })
    marker.set(anchor.x, character.scale.y * 1.77 + .12, anchor.z + step)
    camera.project(marker)
    onFrame(marker)
    frame = requestAnimationFrame(draw)
  }

  function pause() {
    cancelAnimationFrame(frame)
    frame = 0
    observer.disconnect()
  }

  function turn(delta) {
    yaw(pose.yaw + delta)
  }

  function yaw(value) {
    pose.yaw = clamp(value, -.37, .37)
  }

  const observer = new ResizeObserver(resize)
  canvas.addEventListener('pointerdown', event => {
    if (!walking || event.button !== 0) return
    pointer = { x: event.clientX, y: event.clientY, id: event.pointerId }
    canvas.setPointerCapture(event.pointerId)
  })
  canvas.addEventListener('pointermove', event => {
    if (!walking || pointer?.id !== event.pointerId || !canvas.hasPointerCapture(pointer.id)) return
    turn((event.clientX - pointer.x) * .004)
    pose.pitch = clamp(pose.pitch - (event.clientY - pointer.y) * .004, -.18, .14)
    pointer.x = event.clientX
    pointer.y = event.clientY
  })
  canvas.addEventListener('lostpointercapture', () => { pointer = undefined })

  return {
    canvas, turn, pause, play,
    get motions() {
      return Object.keys(motionByType).filter(name => name === 'Idle' || motionByType[name])
    },
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
    edit({ x, z, direction, height, light }) {
      Object.assign(anchor, { x, z })
      character.rotation.y = direction * Math.PI / 180
      character.scale.set(height / 177)
      canvas.style.filter = light === 100 ? '' : 'brightness(' + light + '%)'
    },
    setWalking(active) { walking = active },
    restart() { Object.assign(pose, { x: 0, z: 0, yaw: 0, pitch: 0 }) },
    move(forward, side) {
      const nextX = clamp(pose.x + (forward * Math.sin(pose.yaw) + side * Math.cos(pose.yaw)) * .35, -1.05, 1.1)
      const nextZ = clamp(pose.z + (side * Math.sin(pose.yaw) - forward * Math.cos(pose.yaw)) * .35, -4.15, 0)
      if (Math.hypot(nextX - anchor.x, nextZ - anchor.z) < .62) return
      Object.assign(pose, { x: nextX, z: nextZ })
    },
    distance: () => Math.hypot(pose.x - anchor.x, pose.z - anchor.z),
  }
}
