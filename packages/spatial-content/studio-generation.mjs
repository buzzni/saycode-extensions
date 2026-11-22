const command = 'buzzni.spatial-content.generate'
const modelLimits = { room: 256 * 1024 * 1024, person: 64 * 1024 * 1024 }

function invoke(action, args = {}) {
  if (!window.saycodePanel) return Promise.reject(new Error('GENERATION_UNAVAILABLE'))
  return window.saycodePanel.invokeCommand(command, [action, { version: 1, ...args }])
}

export async function availableGeneration() {
  try {
    return (await invoke('availability')).kinds
  } catch {
    return []
  }
}

function delay(signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return }
    const abort = () => { clearTimeout(timer); reject(signal.reason) }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, 2200)
    signal.addEventListener('abort', abort, { once: true })
  })
}

export async function generateStudioSource(kind, prompt, signal) {
  const { id } = await invoke('start', { kind, prompt })
  try {
    while (true) {
      signal.throwIfAborted()
      const result = await invoke('status', { id })
      if (result.state === 'failed') throw new Error(result.code)
      if (result.state === 'ready') {
        return kind === 'story' ? result.text : await readModel(id, result, modelLimits[kind], signal)
      }
      await delay(signal)
    }
  } finally {
    await invoke('release', { id }).catch(() => undefined)
  }
}

async function readModel(id, { bytes, chunkBytes }, limit, signal) {
  if (!Number.isSafeInteger(bytes) || bytes < 28 || bytes > limit ||
      !Number.isSafeInteger(chunkBytes) || chunkBytes < 1024 || chunkBytes > 40 * 1024) {
    throw new Error('INVALID_MODEL_RESULT')
  }
  const result = new Uint8Array(bytes)
  const count = Math.ceil(bytes / chunkBytes)
  const workers = Math.min(count, 2)
  await Promise.all(Array.from({ length: workers }, async (_, first) => {
    for (let index = first; index < count; index += workers) {
      signal.throwIfAborted()
      const offset = index * chunkBytes
      const chunk = atob(await invoke('read', { id, offset }))
      if (chunk.length !== Math.min(chunkBytes, bytes - offset)) throw new Error('INVALID_MODEL_RESULT')
      for (let i = 0; i < chunk.length; i++) result[offset + i] = chunk.charCodeAt(i)
    }
  }))
  return result.buffer
}
