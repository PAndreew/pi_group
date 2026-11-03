// Uses installed Chromium on the current machine. Synthetic input measures runtime, NOT accuracy.
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.goto((process.env.TEST_URL || 'http://127.0.0.1:5173') + '/lipread/ready.json')
  const result = await page.evaluate((workerPath) => new Promise((resolve, reject) => {
    const began = performance.now()
    const worker = new Worker(workerPath, { type: 'module' })
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Benchmark timed out')) }, 240_000)
    let loadSeconds
    worker.onerror = e => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message)) }
    worker.onmessage = e => {
      if (e.data.ready) {
        loadSeconds = (performance.now() - began) / 1000
        const pixels = new Uint8Array(25 * 88 * 88).fill(107)
        worker.postMessage({ pixels }, [pixels.buffer])
      } else { clearTimeout(timer); worker.terminate(); resolve({ loadSeconds, ...e.data }) }
    }
    worker.postMessage({})
  }), process.env.WORKER_PATH || '/src/lib/lipread.worker.ts')
  console.log(JSON.stringify(result, null, 2))
  if (result.error) process.exitCode = 1
} finally { await browser.close() }
