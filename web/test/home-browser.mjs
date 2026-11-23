import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.on('pageerror', error => console.error(error))
  page.setDefaultTimeout(5000)
  const model = { provider: 'test', id: 'model', name: 'Test model', thinkingLevels: ['off'] }
  const user = { id: 'u1', username: 'Tester', role: 'user', sessionDefaults: { harness: 'pi', model, thinkingLevel: 'off' } }
  const session = { key: 'pi:new', harness: 'pi', path: 'pi-chat', access: 'owner' }
  const writes = []
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (method === 'POST') writes.push({ path, body: route.request().postDataJSON() })
    const body = {
      '/api/auth/me': { user },
      '/api/chats': { chats: [] },
      '/api/projects': { projects: [] },
      '/api/projects/moves': { moves: [] },
      '/api/tenants': { active: 'work', tenants: [{ id: 'work', name: 'Work' }] },
      '/api/sessions': { session },
      '/api/sessions/pi%3Anew': { session },
      '/api/sessions/pi%3Anew/browser': { open: false },
      '/api/harnesses/pi/models': { models: [model] },
      '/api/folders/search': { folders: [], chatFolder: 'pi-chat' },
    }[path] ?? { sessions: [], harnesses: [{ id: 'pi', ok: true }], models: [model], jobs: [], applets: [], watches: [], folders: [], chatFolder: 'pi-chat', tools: [], commands: [], resources: [], interactions: [] }
    await route.fulfill({ json: body })
  })
  let browserKey
  await page.routeWebSocket('**/api/browser?**', socket => {
    browserKey = new URL(socket.url()).searchParams.get('key')
    socket.send(JSON.stringify({ type: 'state', url: 'about:blank', title: '', viewport: { width: 1280, height: 800 }, canInput: true }))
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:15173')
  await page.getByRole('button', { name: 'Current session model' }).filter({ hasText: 'Test model' }).waitFor()
  await page.getByRole('button', { name: 'Shared browser', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'URL or search keyword' })
  await page.locator('#browser-address:enabled').waitFor()
  assert.equal(await address.isEnabled(), true)
  assert.equal(browserKey, session.key)
  assert.deepEqual(writes, [{ path: '/api/sessions', body: { harness: 'pi', path: 'pi-chat', model: { provider: 'test', id: 'model' }, thinkingLevel: 'off' } }], 'the browser creates one empty session without sending a prompt')
  console.log('PASS: home globe starts a session and opens its shared browser without a prompt')
} finally { await browser.close() }
