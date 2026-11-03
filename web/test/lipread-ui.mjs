import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
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
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Camera permission denied', 'NotAllowedError') }
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  const composer = page.locator('[data-composer-box] textarea')
  await composer.fill('Existing draft')
  await page.getByRole('button', { name: 'Silent dictation', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Camera permission denied' }).waitFor({ timeout: 60000 })
  await page.getByRole('button', { name: 'Close camera' }).click()
  assert.equal(await composer.inputValue(), 'Existing draft')
  await composer.fill('Typing still works')
  assert.equal(await composer.inputValue(), 'Typing still works')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS: camera permission error, close, preserved draft, normal typing, mobile width')
} finally { await browser.close() }
