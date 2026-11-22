import { GLTFLoader, Program, Transform, Vec3 } from 'ogl'

const MAX_MODEL_BYTES = 10 * 1024 * 1024
const INVALID_MODEL = '텍스처가 포함된 10 MiB 이하의 GLB 파일을 선택해 주세요.'
const componentSizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const typeSizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

export async function readSceneSource(file) {
  if (!/\.glb$/i.test(file.name) || file.size < 28 || file.size > MAX_MODEL_BYTES) throw new Error(INVALID_MODEL)
  return parseSceneSource(await file.arrayBuffer(), INVALID_MODEL)
}

export function parseSceneSource(bytes, invalid = '지원하는 텍스처가 포함된 GLB 결과를 받지 못했어요.') {
  try {
    if (new DataView(bytes).getUint32(8, true) !== bytes.byteLength) throw new Error()
    const source = GLTFLoader.unpackGLB(bytes)
    source.scene ??= 0
    const binary = source.buffers?.[0]?.binary
    if (source.asset?.version !== '2.0' || source.buffers.length !== 1 || !binary || source.buffers[0].uri ||
        source.extensionsUsed?.length || source.extensionsRequired?.length ||
        source.nodes?.length > 512 || !source.meshes?.length || source.meshes.length > 128) throw new Error()
    const visited = new Set()
    const parented = new Set()
    for (const node of source.nodes) {
      if (node.extensions) throw new Error()
      for (const child of node.children ?? []) {
        if (!Number.isInteger(child) || !source.nodes[child] || parented.has(child)) throw new Error()
        parented.add(child)
      }
    }
    function checkNode(index, depth) {
      const node = source.nodes[index]
      if (!node || visited.has(index) || depth > 48 || node.extensions) throw new Error()
      visited.add(index)
      for (const child of node.children ?? []) checkNode(child, depth + 1)
    }
    const sceneNodes = source.scenes[source.scene].nodes
    if (!sceneNodes.length || sceneNodes.some(root => !Number.isInteger(root) || !source.nodes[root] || parented.has(root))) throw new Error()
    for (const index of source.nodes.keys()) if (!parented.has(index)) checkNode(index, 0)
    if (visited.size !== source.nodes.length || new Set(sceneNodes).size !== sceneNodes.length) throw new Error()
    for (const view of source.bufferViews) {
      const offset = view.byteOffset ?? 0
      if (view.buffer !== 0 || !Number.isInteger(offset) || offset < 0 || !Number.isInteger(view.byteLength) ||
          view.byteLength < 1 || offset + view.byteLength > binary.byteLength || view.extensions) throw new Error()
    }
    for (const accessor of source.accessors) {
      const view = source.bufferViews[accessor.bufferView]
      const size = componentSizes[accessor.componentType] * typeSizes[accessor.type]
      const offset = accessor.byteOffset ?? 0
      const stride = view?.byteStride ?? size
      if (!view || !size || accessor.sparse || !Number.isInteger(accessor.count) || accessor.count < 1 ||
          !Number.isInteger(offset) || offset < 0 || stride < size ||
          offset + stride * (accessor.count - 1) + size > view.byteLength) throw new Error()
    }
    let primitiveCount = 0
    for (const mesh of source.meshes) {
      primitiveCount += mesh.primitives?.length ?? 0
      if (!mesh.primitives?.length || mesh.primitives.length > 32 ||
          mesh.primitives.some(primitive => primitive.extensions || !source.accessors[primitive.attributes?.POSITION])) throw new Error()
    }
    if (primitiveCount > 256) throw new Error()
    if ((source.images?.length ?? 0) > 16) throw new Error()
    source.images = (source.images ?? []).map(image => {
      const view = source.bufferViews?.[image.bufferView]
      if (image.uri || !view || !['image/jpeg', 'image/png'].includes(image.mimeType)) throw new Error()
      return { name: image.name, mimeType: image.mimeType, bytes: new Uint8Array(binary, view.byteOffset ?? 0, view.byteLength) }
    })
    return source
  } catch {
    throw new Error(invalid)
  }
}

async function loadModel(gl, source) {
  // OGL annotates the descriptor while loading. A previous draft may still use
  // this file and each renderer must get its own buffer and texture objects.
  const { buffers, images, ...metadata } = source
  const descriptor = { ...structuredClone(metadata), buffers: buffers.map(buffer => ({ ...buffer })) }
  descriptor.images = await Promise.all(images.map(async image => {
      const blob = new Blob([image.bytes], { type: image.mimeType })
      const uri = await new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
      const probe = new Image()
      probe.src = uri
      await probe.decode()
      if (probe.naturalWidth * probe.naturalHeight > 4096 * 4096) throw new Error(INVALID_MODEL)
      return { name: image.name, uri }
  }))
  const model = await GLTFLoader.parse(gl, descriptor, '')
  await Promise.all((model.images ?? []).map(image => image.decode()))
  return model
}

function group(model, knownName) {
  const named = model.scene.find(node => node.name === knownName)
  if (model.json.scenes[model.json.scene].extras?.spatialPilot === 1 && named) return named
  const root = new Transform()
  for (const node of model.scene) node.setParent(root)
  return root
}

function prepare(gl, root) {
  let count = 0
  root.traverse(mesh => {
    if (!mesh.geometry) return
    const attributes = mesh.geometry.attributes
    const material = mesh.program.gltfMaterial
    const texture = attributes.uv ? material?.baseColorTexture?.texture : null
    const tint = material?.baseColorFactor ?? [1, 1, 1, 1]
    mesh.program.remove()
    mesh.program = mesh.skeleton
      ? skinProgram(gl, texture, Boolean(attributes.color), Boolean(attributes.normal), tint)
      : photoProgram(gl, texture, Boolean(attributes.color), tint)
    count++
  })
  if (!count) throw new Error(INVALID_MODEL)
}

function normalize(root, kind) {
  const parent = new Transform()
  root.setParent(parent)
  parent.updateMatrixWorld()
  const minimum = new Vec3(Infinity)
  const maximum = new Vec3(-Infinity)
  const point = new Vec3()
  root.traverse(mesh => {
    if (!mesh.geometry) return
    mesh.geometry.computeBoundingBox()
    const { min, max } = mesh.geometry.bounds
    for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
      point.set(x, y, z).applyMatrix4(mesh.worldMatrix)
      minimum.set(Math.min(minimum.x, point.x), Math.min(minimum.y, point.y), Math.min(minimum.z, point.z))
      maximum.set(Math.max(maximum.x, point.x), Math.max(maximum.y, point.y), Math.max(maximum.z, point.z))
    }
  })
  const width = maximum.x - minimum.x
  const height = maximum.y - minimum.y
  const depth = maximum.z - minimum.z
  if (![width, height, depth].every(Number.isFinite) || height <= 0 || (kind === 'room' && depth <= 0)) {
    throw new Error(INVALID_MODEL)
  }
  const scale = kind === 'room' ? 11 / depth : 1.77 / height
  parent.scale.set(scale)
  parent.position.set(-(minimum.x + maximum.x) * scale / 2, -minimum.y * scale,
    -(minimum.z + maximum.z) * scale / 2 - (kind === 'room' ? 5 : 0))
  const result = new Transform()
  parent.setParent(result)
  return result
}

export async function readPilotModel({ sample, room, person }, gl) {
  const bundled = sample ? await loadModel(gl, sample) : null
  const [space, actor] = await Promise.all([
    room ? loadModel(gl, room) : bundled,
    person ? loadModel(gl, person) : bundled,
  ])
  const lobby = group(space, 'Lobby')
  const character = group(actor, 'Staff')
  prepare(gl, lobby)
  prepare(gl, character)
  return {
    lobby: room && room.scenes[room.scene].extras?.spatialPilot !== 1 ? normalize(lobby, 'room') : lobby,
    character: person && person.scenes[person.scene].extras?.spatialPilot !== 1 ? normalize(character, 'person') : character,
    motions: Object.fromEntries(actor.animations.map(({ name, animation }) => [name, animation])),
  }
}

function photoProgram(gl, texture, hasColor, tint) {
  return new Program(gl, {
    cullFace: null,
    uniforms: { tint: { value: tint }, ...(texture && { photo: { value: texture } }) },
    vertex: `
      attribute vec3 position;
      uniform mat4 modelViewMatrix, projectionMatrix;
      ${texture ? 'attribute vec2 uv; varying vec2 photoUV;' : ''}
      ${hasColor ? 'attribute vec3 color; varying vec3 vertexColor;' : ''}
      void main() {
        ${texture ? 'photoUV = uv;' : ''}
        ${hasColor ? 'vertexColor = color;' : ''}
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragment: `
      precision mediump float;
      uniform vec4 tint;
      ${texture ? 'varying vec2 photoUV; uniform sampler2D photo;' : ''}
      ${hasColor ? 'varying vec3 vertexColor;' : ''}
      void main() {
        gl_FragColor = tint ${texture ? '* texture2D(photo, photoUV)' : ''} ${hasColor ? '* vec4(vertexColor, 1.0)' : ''};
      }`,
  })
}

function skinProgram(gl, texture, hasColor, hasNormal, tint) {
  const hasPhoto = Boolean(texture)
  return new Program(gl, {
    cullFace: null,
    uniforms: { tint: { value: tint }, ...(hasPhoto && { photo: { value: texture } }) },
    vertex: `
      attribute vec3 position;
      ${hasNormal ? 'attribute vec3 normal;' : ''}
      ${hasColor ? 'attribute vec3 color;' : ''}
      uniform vec4 tint;
      ${hasPhoto ? 'attribute vec2 uv; varying vec2 photoUV; varying float facing;' : ''}
      attribute vec4 skinIndex, skinWeight;
      uniform mat4 modelViewMatrix, projectionMatrix;
      uniform sampler2D boneTexture;
      uniform float boneTextureSize;
      varying vec3 tinted;
      vec4 bonePixel(float n) {
        return texture2D(boneTexture, (vec2(mod(n, boneTextureSize), floor(n / boneTextureSize)) + .5) / boneTextureSize);
      }
      mat4 bone(float n) {
        float i = n * 4.0;
        return mat4(bonePixel(i), bonePixel(i+1.0), bonePixel(i+2.0), bonePixel(i+3.0));
      }
      void main() {
        mat4 bind = bone(skinIndex.x) * skinWeight.x + bone(skinIndex.y) * skinWeight.y
          + bone(skinIndex.z) * skinWeight.z + bone(skinIndex.w) * skinWeight.w;
        vec3 surface = ${hasNormal ? 'normalize(mat3(bind) * normal)' : 'vec3(0.0, 0.0, 1.0)'};
        float light = .88 + .16 * max(0.0, dot(surface, normalize(vec3(-.4, .8, .65))));
        tinted = ${hasColor ? 'color * ' : ''}tint.rgb * light;
        ${hasPhoto ? `photoUV = uv; facing = ${hasNormal && hasColor ? 'normal.z' : '1.0'};` : ''}
        gl_Position = projectionMatrix * modelViewMatrix * bind * vec4(position, 1.0);
      }`,
    fragment: `
      precision mediump float;
      varying vec3 tinted;
      ${hasPhoto ? 'varying vec2 photoUV; varying float facing; uniform sampler2D photo;' : ''}
      void main() {
        ${hasPhoto ? 'vec4 projected = texture2D(photo, photoUV);' : ''}
        gl_FragColor = vec4(${hasPhoto ? 'mix(tinted, projected.rgb, projected.a * smoothstep(.18, .78, facing))' : 'tinted'}, 1.0);
      }`,
  })
}
