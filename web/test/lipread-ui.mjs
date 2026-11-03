import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.on('pageerror', error => console.error('Browser error:', error.stack))
  const modelRequests = []
  page.on('request', request => { if (/\.(onnx|tflite|wasm)(\?|$)/.test(request.url())) modelRequests.push(request.url()) })
  let holdNext = false, releaseHeld, enteredHeld
  const heldRequest = new Promise(resolve => { enteredHeld = resolve })
  const finishHeld = new Promise(resolve => { releaseHeld = resolve })
  let uploaded = 0
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/lipread/transcribe') {
      assert.match(route.request().headers()['content-type'], /^video\//)
      assert.ok(route.request().postDataBuffer().length > 0, 'upload the actual recorded clip')
      uploaded++
      if (holdNext) { enteredHeld(); await finishHeld }
      await route.fulfill({ json: { text: 'HELLO THERE', seconds: 0.1, inferenceSeconds: 0.05, duration: 1 } }).catch(() => {})
      return
    }
    const bodies = {
      '/api/auth/me': { user: { id: 'u', username: 'Tester', role: 'user' } },
      '/api/harnesses': { harnesses: [{ id: 'pi', ok: true }] }, '/api/chats': { chats: [] }, '/api/users/directory': { users: [] },
      '/api/tenants': { tenants: [{ id: 'default', name: 'Default' }], tenantId: 'default' },
      '/api/jobs': { jobs: [] }, '/api/applets': { applets: [] }, '/api/projects': { projects: [] },
      '/api/projects/moves': { moves: [] }, '/api/notifications': { notifications: [] },
      '/api/lipread/config': { mode: 'server', ready: true, correction: false },
    }
    const body = bodies[path] ?? (path.endsWith('/models') ? { models: [] } : path.includes('folders') ? { folders: [], chatFolder: 'pi-chat' } : path.includes('tools') ? { tools: [], commands: [], resources: [] } : path.includes('sessions') ? { sessions: [] } : {})
    await route.fulfill({ json: body })
  })
  await page.addInitScript(() => {
    window.workerCount = 0; window.cameraCalls = 0
    const OriginalWorker = window.Worker
    window.Worker = class extends OriginalWorker { constructor(...args) { super(...args); window.workerCount++ } }
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
  await dictate.waitFor({ timeout: 5000 })
  assert.equal(await dictate.isEnabled(), true)
  assert.equal(await page.getByRole('button', { name: 'Preparing silent dictation' }).count(), 0)
  assert.equal(await page.evaluate(() => window.cameraCalls), 0)
  await composer.fill('Normal typing'); assert.equal(await send.isEnabled(), true); await composer.fill('')
  await dictate.click(); await hint.filter({ hasText: 'Camera permission denied' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Silent dictation', exact: true }).count(), 0)
  await page.evaluate(() => { window.allowTestCamera = true })
  await dictate.click(); await stop.waitFor({ timeout: 5000 })
  assert.equal(await page.locator('video').count(), 0)
  assert.equal(await stop.evaluate(element => element.classList.contains('text-red-500')), true)
  await composer.fill('Keep typed draft')
  assert.equal(await send.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.testCameraTrack.readyState), 'ended')
  await composer.fill(''); await dictate.click(); await stop.waitFor(); await page.waitForTimeout(650); await stop.click()
  await page.waitForFunction(() => document.querySelector('[data-composer-box] textarea')?.value === 'HELLO THERE')
  assert.equal(await send.isEnabled(), true)
  assert.match(await hint.innerText(), /Review your draft/)
  assert.equal(await page.evaluate(() => window.testCameraTrack.readyState), 'ended')
  assert.equal(uploaded, 1)
  await composer.fill(''); holdNext = true
  await dictate.click(); await stop.waitFor(); await page.waitForTimeout(650); await stop.click()
  await heldRequest
  await composer.fill('Do not overwrite me'); releaseHeld(); await page.waitForTimeout(100)
  assert.equal(await composer.inputValue(), 'Do not overwrite me')
  assert.equal(await send.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.workerCount), 0)
  assert.deepEqual(modelRequests, [])
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS: no browser models/workers, immediate recording, no modal/preview, native upload, typing cancellation, no stale overwrite')
} finally { await browser.close() }
