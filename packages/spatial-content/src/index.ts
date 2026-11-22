import { defineExtension } from '@buzzni/saycode-extension-sdk'

const sampleUrl = 'saycode-extension://buzzni.spatial-content/assets/photoreal-lobby-pilot.mjs'
const chunkBytes = 24 * 1024

async function openSample() {
  const { default: encoded } = await import(sampleUrl)
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0))
  const data = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(data).arrayBuffer())
}

export default defineExtension({
  activate(context) {
    context.commands.register('buzzni.spatial-content.open', () => null)
    context.commands.register('buzzni.spatial-content.generate', (action, args) => {
      if (typeof action !== 'string' || !['availability', 'start', 'status', 'read', 'release'].includes(action)) {
        throw new Error('INVALID_REQUEST')
      }
      return context.invokeCapability('content.generate', action, args)
    })
    let sample: Promise<Uint8Array> | undefined
    context.commands.register('buzzni.spatial-content.read-sample', async index => {
      if (index !== null && (typeof index !== 'number' || !Number.isInteger(index) || index < 0)) {
        throw new Error('Invalid 3D sample segment')
      }
      sample ??= openSample().catch(error => {
        sample = undefined
        throw error
      })
      const data = await sample
      if (index === null) return { bytes: data.byteLength, chunkBytes }
      const start = index * chunkBytes
      if (start >= data.byteLength) throw new Error('3D sample segment is out of bounds')
      return btoa(String.fromCharCode(...data.subarray(start, start + chunkBytes)))
    })
  },
})
