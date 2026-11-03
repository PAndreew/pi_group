import * as ort from 'onnxruntime-web/wasm'
import { decodeCTC } from './lipread-math'
let session: ort.InferenceSession | undefined
let tokens: string[]
ort.env.wasm.wasmPaths = {
  mjs: new URL('../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', import.meta.url).href,
  wasm: '/lipread/ort/ort-wasm-simd-threaded.wasm',
}
ort.env.wasm.numThreads = 1 // No cross-origin isolation required; works on phones too.
self.onmessage = async (event: MessageEvent<{ pixels?: Uint8Array }>) => {
  try {
    if (!session) {
      const response = await fetch('/lipread/tokens.json')
      if (!response.ok) throw new Error('Lip-reading assets are missing')
      tokens = await response.json()
      session = await ort.InferenceSession.create('/lipread/lipread_ctc.int8.onnx', { executionProviders: ['wasm'], graphOptimizationLevel: 'all' })
    }
    const pixels = event.data.pixels
    if (!pixels) { self.postMessage({ ready: true }); return }
    const frames = pixels.length / (88 * 88)
    if (!Number.isInteger(frames) || frames < 5 || frames > 500) throw new Error('Invalid frame count')
    const data = Float32Array.from(pixels, p => (p / 255 - 0.421) / 0.165)
    const input = new ort.Tensor('float32', data, [1, 1, frames, 88, 88])
    const start = performance.now()
    const output = await session.run({ video: input })
    try {
      const text = decodeCTC(output.log_probs.data as Float32Array, tokens)
      self.postMessage({ text, seconds: (performance.now() - start) / 1000 })
    } finally { input.dispose(); Object.values(output).forEach(t => t.dispose()) }
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }) }
}
