export interface LipreadResult { text: string; seconds: number }
export interface LoadProgress { phase: 'download' | 'initializing'; loaded?: number; total?: number }
interface Client {
  ready: Promise<void>
  worker: Worker
  listeners: Set<(progress: LoadProgress) => void>
  progress?: LoadProgress
  pending: Map<number, { resolve: (result: LipreadResult) => void; reject: (error: Error) => void }>
}
let shared: Client | undefined
let nextId = 1

function client(): Client {
  if (shared) return shared
  const worker = new Worker(new URL('./lipread.worker.ts', import.meta.url), { type: 'module' })
  let resolve!: () => void, reject!: (error: Error) => void
  const ready = new Promise<void>((yes, no) => { resolve = yes; reject = no })
  const current: Client = { worker, ready, listeners: new Set(), pending: new Map() }
  shared = current
  const fail = (message: string) => {
    const error = new Error(message)
    clearTimeout(timer)
    reject(error); current.pending.forEach(p => p.reject(error)); current.pending.clear()
    worker.terminate(); if (shared === current) shared = undefined
  }
  const timer = setTimeout(() => fail('Model loading timed out. Check the connection; this device may also lack sufficient memory.'), 120_000)
  worker.onerror = event => fail(event.message || 'Model worker failed. This browser may lack WASM support or memory.')
  worker.onmessage = ({ data }) => {
    if (data.progress) { current.progress = data.progress; current.listeners.forEach(fn => fn(data.progress)); return }
    if (data.ready) { clearTimeout(timer); resolve(); return }
    if (data.error && data.id === undefined) { fail(data.error); return }
    const request = current.pending.get(data.id)
    if (!request) return
    current.pending.delete(data.id)
    if (data.error) request.reject(new Error(data.error))
    else request.resolve({ text: data.text, seconds: data.seconds })
  }
  worker.postMessage({})
  return current
}

/** Keep the model worker warm until page unload. Never holds a camera stream or video frames. */
export function warmLipreader(onProgress: (progress: LoadProgress) => void) {
  const current = client()
  current.listeners.add(onProgress)
  if (current.progress) onProgress(current.progress)
  return { ready: current.ready, unsubscribe: () => current.listeners.delete(onProgress) }
}
export async function transcribeLips(pixels: Uint8Array): Promise<LipreadResult> {
  const current = client()
  await current.ready
  const id = nextId++
  return new Promise((resolve, reject) => {
    current.pending.set(id, { resolve, reject })
    current.worker.postMessage({ id, pixels }, [pixels.buffer])
  })
}
