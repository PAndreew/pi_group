import * as ort from 'onnxruntime-web/wasm'
import { decodeCTC } from './lipread-math'
let session: ort.InferenceSession
let tokens: string[]
let initialization: Promise<void> | undefined
ort.env.wasm.wasmPaths = {
  mjs: new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
  wasm: '/lipread/ort/ort-wasm-simd-threaded.wasm',
}
ort.env.wasm.numThreads = 1
async function initialize() {
  const vocabulary = await fetch('/lipread/tokens.json', { signal: AbortSignal.timeout(120_000) })
  if (!vocabulary.ok) throw new Error(`Vocabulary download failed (${vocabulary.status})`)
  tokens = await vocabulary.json()
  const response = await fetch('/lipread/lipread_ctc.int8.onnx', { signal: AbortSignal.timeout(120_000) })
  if (!response.ok || !response.body) throw new Error(`Model download failed (${response.status})`)
  if ((response.headers.get('Content-Type') ?? '').includes('text/html')) throw new Error('Model file is missing on this Beezy installation')
  const total = Number(response.headers.get('Content-Length')) || undefined
  if (total && total > 300_000_000) throw new Error('Unexpected model size')
  const reader = response.body.getReader()
  let loaded = 0, reported = 0
  const buffer = total ? new Uint8Array(total) : undefined
  const chunks: Uint8Array[] = []
  self.postMessage({ progress: { phase: 'download', loaded, total } })
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (loaded + value.length > 300_000_000 || (buffer && loaded + value.length > buffer.length)) throw new Error('Unexpected model size')
    if (buffer) buffer.set(value, loaded); else chunks.push(value)
    loaded += value.length
    if (performance.now() - reported > 200) {
      reported = performance.now(); self.postMessage({ progress: { phase: 'download', loaded, total } })
    }
  }
  if (total && loaded !== total) throw new Error('Model download was interrupted; try again')
  const bytes = buffer ?? new Uint8Array(loaded)
  if (!buffer) { let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length } chunks.length = 0 }
  self.postMessage({ progress: { phase: 'initializing', loaded, total } })
  session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
}
let queue = Promise.resolve()
self.onmessage = (event: MessageEvent<{ id?: number; pixels?: Uint8Array }>) => {
  queue = queue.then(async () => {
    const { id, pixels } = event.data
    try {
      await (initialization ??= initialize())
      if (!pixels) { self.postMessage({ ready: true }); return }
      const frames = pixels.length / (88 * 88)
      if (!Number.isInteger(frames) || frames < 5 || frames > 500) throw new Error('Invalid frame count')
      const data = Float32Array.from(pixels, p => (p / 255 - 0.421) / 0.165)
      const input = new ort.Tensor('float32', data, [1, 1, frames, 88, 88])
      const start = performance.now()
      const output = await session.run({ video: input })
      try { self.postMessage({ id, text: decodeCTC(output.log_probs.data as Float32Array, tokens), seconds: (performance.now() - start) / 1000 }) }
      finally { input.dispose(); Object.values(output).forEach(t => t.dispose()) }
    } catch (error) { self.postMessage({ id, error: error instanceof Error ? error.message : String(error) }) }
  })
}
