import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', e => console.error('Browser error:', e.stack))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/harnesses') body = { harnesses: [{ id: 'pi', ok: true }] }
    else if (path.endsWith('/models')) body = { models: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/users/directory') body = { users: [] }
    else if (path.includes('folders')) body = { folders: [], chatFolder: 'pi-chat' }
    else if (path.includes('tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('sessions')) body = { sessions: [] }
    else if (path === '/api/tenants') body = { tenants: [{ id: 'default', name: 'Default' }], tenantId: 'default' }
    else if (path === '/api/jobs') body = { jobs: [] }
    else if (path === '/api/applets') body = { applets: [] }
    else if (path === '/api/projects') body = { projects: [] }
    else if (path === '/api/projects/moves') body = { moves: [] }
    else if (path === '/api/notifications') body = { notifications: [] }
    else if (path === '/api/lipread/config') body = { correction: false }
    await route.fulfill({ json: body })
  })
  // Test UI/state sequencing independently of recognition accuracy, with deterministic crops.
  await page.route(/\/src\/lib\/lipread-camera\.ts(?:\?.*)?$/, route => route.fulfill({ contentType: 'application/javascript', body: `
    export async function warmDetector() { return {} }
    export function captureFrame(video, detector, time) { return { time } }
    export async function trackFrames() {}
    export function prepareCrops() { return { pixels: new Uint8Array(25*88*88), fps: 25, duration: 1 } }
  ` }))
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    window.modelWorkerCount = 0; window.cameraCalls = 0
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options); this.isLipread = String(url).includes('lipread.worker')
        if (this.isLipread) window.modelWorkerCount++
      }
      postMessage(data, ...rest) {
        if (!this.isLipread) return super.postMessage(data, ...rest)
        if (!data.pixels) {
          window.markModelReady = () => this.dispatchEvent(new MessageEvent('message', { data: { ready: true } }))
          this.dispatchEvent(new MessageEvent('message', { data: { progress: { phase: 'download', loaded: 10_000_000, total: 203_000_000 } } }))
          return
        }
        const finish = () => this.dispatchEvent(new MessageEvent('message', { data: { id: data.id, text: 'HELLO THERE', seconds: 0.01 } }))
        if (window.holdInference) window.finishInference = finish
        else setTimeout(finish, 10)
      }
    }
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async constraints => {
      window.cameraCalls++
      if (!window.allowTestCamera) throw new DOMException('Camera permission denied', 'NotAllowedError')
      const stream = await original(constraints); window.testCameraTrack = stream.getVideoTracks()[0]; return stream
    }
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  const composer = page.locator('[data-composer-box] textarea')
  const hint = page.locator('[data-composer-box] [role="status"]')
  const dictate = page.getByRole('button', { name: 'Silent dictation', exact: true })
  const stop = page.getByRole('button', { name: 'Stop silent dictation', exact: true })
  const send = page.getByRole('button', { name: 'Send', exact: true })
  await page.getByRole('button', { name: 'Preparing silent dictation' }).waitFor()
  await page.waitForFunction(() => Boolean(window.markModelReady))
  assert.equal(await page.evaluate(() => window.cameraCalls), 0, 'preload must not request camera permission')
  assert.equal(await page.evaluate(() => window.modelWorkerCount), 1, 'preload starts before dictation click')
  await composer.fill('Typing during preload')
  assert.equal(await send.isEnabled(), true)
  await composer.fill('')
  await page.evaluate(() => window.markModelReady())
  await dictate.waitFor(); assert.equal(await dictate.isEnabled(), true)
  assert.equal(await dictate.evaluate(el => el.classList.contains('text-blue-500')), true)
  await dictate.click()
  await hint.filter({ hasText: 'Camera permission denied' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Silent dictation', exact: true }).count(), 0)
  await page.evaluate(() => { window.allowTestCamera = true })
  await dictate.click(); await stop.waitFor({ timeout: 5000 })
  assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '0')
  assert.equal(await stop.evaluate(el => el.classList.contains('text-red-500')), true)
  await composer.fill('Keep typed draft')
  assert.equal(await send.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.testCameraTrack.readyState), 'ended', 'typing cancels camera capture')
  await composer.fill(''); await dictate.click(); await stop.waitFor(); await page.waitForTimeout(600); await stop.click()
  await page.waitForFunction(() => document.querySelector('[data-composer-box] textarea')?.value === 'HELLO THERE')
  assert.equal(await send.isEnabled(), true)
  assert.match(await hint.innerText(), /Review your draft/)
  assert.equal(await page.evaluate(() => window.testCameraTrack.readyState), 'ended')
  assert.equal(await page.evaluate(() => window.modelWorkerCount), 1)
  assert.equal(await page.getByRole('dialog', { name: 'Silent dictation', exact: true }).count(), 0)
  // An inference finishing after the user starts typing must never overwrite their draft.
  await composer.fill(''); await page.evaluate(() => { window.holdInference = true })
  await dictate.click(); await stop.waitFor(); await page.waitForTimeout(600); await stop.click()
  await page.waitForFunction(() => Boolean(window.finishInference))
  await composer.fill('Do not overwrite me'); await page.evaluate(() => window.finishInference())
  await page.waitForTimeout(100)
  assert.equal(await composer.inputValue(), 'Do not overwrite me')
  assert.equal(await send.isEnabled(), true)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS: eager preload without camera, no modal/preview, button states, stop-to-draft, typing cancellation, no stale overwrite')
} finally { await browser.close() }
