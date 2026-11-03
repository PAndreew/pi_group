// Loads the actual model/detector from a production build; no real account, camera or messages.
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const bodies = {
      '/api/auth/me': { user: { id: 'u', username: 'Tester', role: 'user' } },
      '/api/harnesses': { harnesses: [{ id: 'pi', ok: true }] },
      '/api/chats': { chats: [] }, '/api/users/directory': { users: [] },
      '/api/tenants': { tenants: [{ id: 'default', name: 'Default' }], tenantId: 'default' },
      '/api/jobs': { jobs: [] }, '/api/applets': { applets: [] }, '/api/projects': { projects: [] },
      '/api/projects/moves': { moves: [] }, '/api/notifications': { notifications: [] },
      '/api/lipread/config': { correction: false },
    }
    const body = bodies[path] ?? (path.endsWith('/models') ? { models: [] } : path.includes('folders') ? { folders: [], chatFolder: 'pi-chat' } : path.includes('tools') ? { tools: [], commands: [], resources: [] } : path.includes('sessions') ? { sessions: [] } : {})
    await route.fulfill({ json: body })
  })
  await page.addInitScript(() => {
    window.cameraCalls = 0
    navigator.mediaDevices.getUserMedia = async () => { window.cameraCalls++; throw new DOMException('Camera permission denied', 'NotAllowedError') }
  })
  const start = Date.now()
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8788')
  const ready = page.getByRole('button', { name: 'Silent dictation', exact: true })
  await ready.waitFor({ timeout: 60000 })
  assert.equal(await ready.isEnabled(), true)
  assert.equal(await page.evaluate(() => window.cameraCalls), 0)
  assert.equal(await page.getByRole('dialog', { name: 'Silent dictation', exact: true }).count(), 0)
  assert.equal(await page.locator('video').count(), 0)
  console.log(`Actual model and detector ready before click: ${((Date.now() - start) / 1000).toFixed(1)}s`)
  await ready.click()
  await page.locator('[data-composer-box] [role="status"]').filter({ hasText: 'Camera permission denied' }).waitFor()
  assert.equal(await page.getByRole('dialog', { name: 'Silent dictation', exact: true }).count(), 0)
  await page.locator('[data-composer-box] textarea').fill('Normal typing')
  assert.equal(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled(), true)
  await page.goto('about:blank') // Unload the deliberately warm model before shutting Chromium down.
  console.log('PASS: actual eager preload, no camera before click, no modal, inline error, normal Send')
} finally { await browser.close() }
