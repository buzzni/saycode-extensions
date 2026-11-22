import { GLTFLoader, Program } from 'ogl'

const MAX_MODEL_BYTES = 10 * 1024 * 1024
const MOTIONS = ['Idle', 'Walk', 'Greet']
const INVALID_MODEL = '올바른 3D 로비 검증용 GLB 파일을 선택해 주세요.'

export async function readPilotModel(file, gl) {
  if (!/\.glb$/i.test(file.name) || file.size < 28 || file.size > MAX_MODEL_BYTES) throw new Error(INVALID_MODEL)
  const bytes = await file.arrayBuffer()
  const header = new DataView(bytes)
  if (header.getUint32(8, true) !== bytes.byteLength) throw new Error(INVALID_MODEL)
  try {
    const source = GLTFLoader.unpackGLB(bytes)
    const scene = source.scenes?.[source.scene]
    const binary = source.buffers?.[0]?.binary
    if (
      scene?.extras?.spatialPilot !== 1
      || source.buffers.length !== 1 || !binary || source.buffers[0].uri
      || source.extensionsUsed?.length || source.extensionsRequired?.length
      || !scene.nodes.some(index => source.nodes[index]?.name === 'Lobby')
      || !scene.nodes.some(index => source.nodes[index]?.name === 'Staff')
      || !MOTIONS.every(name => source.animations?.some(animation => animation.name === name))
    ) throw new Error(INVALID_MODEL)

    // The extension panel allows embedded image data only. Decode the GLB's own
    // texture bytes and use data URLs so the loader never requests another file.
    source.images = await Promise.all((source.images ?? []).map(async image => {
      const view = source.bufferViews?.[image.bufferView]
      if (
        image.uri || !['image/jpeg', 'image/png'].includes(image.mimeType)
        || view?.buffer !== 0 || !Number.isInteger(view.byteOffset) || view.byteOffset < 0
        || !Number.isInteger(view.byteLength) || view.byteLength < 1
        || view.byteOffset + view.byteLength > binary.byteLength
      ) throw new Error(INVALID_MODEL)
      const blob = new Blob([new Uint8Array(binary, view.byteOffset, view.byteLength)], { type: image.mimeType })
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
    const model = await GLTFLoader.parse(gl, source, '')
    await Promise.all((model.images ?? []).map(image => image.decode()))
    const character = model.scene.find(node => node.name === 'Staff')
    const lobby = model.scene.find(node => node.name === 'Lobby')
    if (!character || !lobby || !model.json.skins?.length) throw new Error(INVALID_MODEL)
    let texturedSurfaces = 0
    let skinnedSurfaces = 0
    for (const root of model.scene) {
      root.traverse(mesh => {
        if (!mesh.geometry) return
        const texture = mesh.program.gltfMaterial?.baseColorTexture?.texture
        mesh.program.remove()
        if (mesh.skeleton && mesh.geometry.attributes.color) {
          mesh.program = skinProgram(gl, mesh.geometry.attributes.uv ? texture : null)
          skinnedSurfaces++
        } else if (texture && mesh.geometry.attributes.uv) {
          mesh.program = photoProgram(gl, texture)
          texturedSurfaces++
        } else throw new Error(INVALID_MODEL)
      })
    }
    if (!texturedSurfaces || !skinnedSurfaces) throw new Error(INVALID_MODEL)
    return { character, lobby, motions: Object.fromEntries(model.animations.map(({ name, animation }) => [name, animation])) }
  } catch {
    throw new Error(INVALID_MODEL)
  }
}

function photoProgram(gl, texture) {
  return new Program(gl, {
    cullFace: null,
    uniforms: { photo: { value: texture } },
    vertex: `
      attribute vec3 position;
      attribute vec2 uv;
      uniform mat4 modelViewMatrix, projectionMatrix;
      varying vec2 photoUV;
      void main() {
        photoUV = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragment: `
      precision mediump float;
      varying vec2 photoUV;
      uniform sampler2D photo;
      void main() { gl_FragColor = texture2D(photo, photoUV); }`,
  })
}

function skinProgram(gl, texture) {
  const hasPhoto = Boolean(texture)
  return new Program(gl, {
    cullFace: null,
    uniforms: hasPhoto ? { photo: { value: texture } } : {},
    vertex: `
      attribute vec3 position, normal, color;
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
        vec3 surface = normalize(mat3(bind) * normal);
        float light = .88 + .16 * max(0.0, dot(surface, normalize(vec3(-.4, .8, .65))));
        tinted = color * light;
        ${hasPhoto ? 'photoUV = uv; facing = normal.z;' : ''}
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
