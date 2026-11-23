import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const user = { id: 'u1', username: 'Tester', role: 'user' }
  const chat = { id: 'test', title: 'Test chat', folder: '', pi: true, sessionKey: 'pi:test', members: [user] }
  const text = '[Site with an icon](https://icon.example.net/docs?private=1) · [Site without an icon](https://missing.example.net/docs)\n\n```preview\nhttps://icon.example.net/preview\n```'
  const messages = [{ id: 1, chatId: 'test', createdAt: new Date().toISOString(), status: 'done', message: { role: 'assistant', author: user, content: [{ type: 'text', text }] } }]
  await page.route('https://www.google.com/s2/favicons?**', async route => {
    const params = new URL(route.request().url()).searchParams
    if (params.get('domain') !== 'icon.example.net') return route.fulfill({ status: 404 })
    assert.deepEqual([...params.keys()], ['domain', 'sz'], 'favicon lookup sends the hostname, not the full link')
    return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="blue"/></svg>' })
  })
  await page.route('https://icon.example.net/broken.ico', route => route.fulfill({ status: 404 }))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = { user }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/chats/test') body = { chat, messages }
    else if (path === '/api/sessions/pi%3Atest/generate-title') body = { name: 'Generated title' }
    else if (path === '/api/link-preview') body = { title: 'Preview card', icon: 'https://icon.example.net/broken.ico' }
    else if (path === '/api/chats/test/messages') body = { messages: [] }
    else if (path === '/api/jobs') body = { jobs: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/harnesses') body = { harnesses: [] }
    else if (path === '/api/projects') body = { projects: [] }
    else if (path === '/api/applets') body = { applets: [] }
    else if (path === '/api/users/directory') body = { users: [user] }
    else if (path.includes('/sessions/active')) body = { sessions: [] }
    else if (path.includes('/tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('/interactions')) body = { interactions: [] }
    else if (path.includes('/models')) body = { models: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${base}/#c=test`)
  const withIcon = page.getByRole('link', { name: 'Site with an icon' })
  const withoutIcon = page.getByRole('link', { name: 'Site without an icon' })
  await withIcon.locator('img:not(.opacity-0)').waitFor()
  await withoutIcon.locator('img').waitFor({ state: 'detached' })
  await withoutIcon.locator('.lucide-globe').waitFor()
  assert.ok(await withIcon.locator('img').evaluate(el => parseFloat(getComputedStyle(el.parentElement).borderRadius) >= el.parentElement.offsetWidth / 2), 'favicon sits in a circle')
  const preview = page.getByRole('link', { name: /Preview card/ })
  await preview.locator('img[src*="google.com"]:not(.opacity-0)').waitFor({ timeout: 3000 })
  await page.getByRole('button', { name: 'Chat actions' }).click()
  await page.getByRole('menuitem', { name: 'Generate title' }).click()
  await page.getByText('Generated title', { exact: true }).waitFor()
  await withIcon.locator('img:not(.opacity-0)').waitFor()
  await preview.locator('img[src*="google.com"]:not(.opacity-0)').waitFor()
  console.log('PASS: favicons and fallback badges remain visible after title generation')
} finally { await browser.close() }
