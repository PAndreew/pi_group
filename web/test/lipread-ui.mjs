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
    await route.fulfill({ json: body })
  })
  // Deterministically simulate denied permission without needing a real camera.
  await page.addInitScript(() => {
    const OriginalWorker = window.Worker
    window.modelWorkerCount = 0
    window.Worker = class extends OriginalWorker {
      constructor(url, options) {
        super(url, options)
        this.isLipread = String(url).includes('lipread.worker')
        if (this.isLipread) window.modelWorkerCount++
      }
      postMessage(data, ...rest) {
        if (this.isLipread && !data.pixels) {
          // Deliberately never ready: camera must not wait for the model.
          setTimeout(() => this.dispatchEvent(new MessageEvent('message', { data: { progress: { phase: 'download', loaded: 10_000_000, total: 203_000_000 } } })), 0)
          return
        }
        super.postMessage(data, ...rest)
      }
    }
    const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (!window.allowTestCamera) throw new DOMException('Camera permission denied', 'NotAllowedError')
      const stream = await original(constraints)
      window.testCameraTrack = stream.getVideoTracks()[0]
      return stream
    }
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  const composer = page.locator('[data-composer-box] textarea')
  const dictate = page.getByRole('button', { name: 'Silent dictation', exact: true })
  await dictate.waitFor()
  assert.equal(await dictate.isEnabled(), true)
  assert.equal(await dictate.evaluate(el => getComputedStyle(el).color), 'oklch(0.623 0.214 259.815)')
  await composer.fill('Existing draft')
  assert.equal(await dictate.count(), 0, 'typing replaces dictation with Send')
  assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled(), true)
  await composer.fill('')
  await dictate.click()
  await page.getByRole('alert').filter({ hasText: 'Camera permission denied' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Close camera' }).click()
  assert.equal(await composer.inputValue(), '')
  await composer.fill('Typing still works')
  assert.equal(await composer.inputValue(), 'Typing still works')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await composer.fill('')
  await page.evaluate(() => { window.allowTestCamera = true })
  await dictate.click()
  const stop = page.getByRole('button', { name: 'Stop & transcribe' })
  await stop.waitFor({ timeout: 5000 })
  assert.equal(await page.locator('video').evaluate(el => getComputedStyle(el).opacity), '0', 'camera preview is hidden')
  assert.match(await page.locator('[data-model-status]').innerText(), /Downloading model/)
  assert.equal(await page.evaluate(() => window.modelWorkerCount), 1, 'reopening reuses the model worker')
  assert.equal(await page.getByRole('button', { name: 'Start recording', exact: true }).count(), 0, 'recording starts without a second click')
  await page.waitForTimeout(1200)
  await stop.click()
  await stop.waitFor({ state: 'detached' }) // Manual stop leaves recording; synthetic input is not an accuracy test.
  await page.getByRole('button', { name: 'Close camera' }).click()
  assert.equal(await page.evaluate(() => window.testCameraTrack.readyState), 'ended')
  assert.equal(await composer.inputValue(), '')
  console.log('PASS: hidden preview, recording before model loads, download progress, warm-worker reuse, manual stop and camera cleanup')
} finally { await browser.close() }
