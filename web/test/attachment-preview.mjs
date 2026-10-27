import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/tenants\/[^/]+/, '')
    let body = { moves: [], requests: [], models: [], harnesses: [], projects: [{ id: 'general', name: 'General', general: true, folder: '', links: [] }], tenants: [], jobs: [], applets: [], sessions: [], users: [], folders: [], chatFolder: 'pi-chat' }
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/sessions/s') body = { session: { key: 's', harness: 'pi', path: '', access: 'owner', live: false } }
    else if (path === '/api/fs/upload') body = { files: [{ path: 'uploads/sample.png' }] }
    else if (path === '/api/fs/raw') return route.fulfill({ contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
    else if (path === '/api/chats/test') body = { chat: { id: 'test', folder: '', members: [], pi: false }, messages: [] }
    else if (path.endsWith('/models')) body = { models: [] }
    else if (path.endsWith('/messages')) body = { messages: [] }
    else if (path.endsWith('/interactions')) body = { interactions: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path.includes('/sessions')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/#s=s`)
  await page.locator('main input[type="file"][multiple]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') })
  await page.getByRole('button', { name: 'Remove sample.png', exact: true }).waitFor({ timeout: 3000 })
  const preview = page.getByRole('img', { name: 'sample.png', exact: true })
  await preview.waitFor({ timeout: 3000 })
  assert.ok(await preview.evaluate(el => el.complete && el.naturalWidth > 0))
  assert.ok(await page.getByRole('button', { name: 'Send', exact: true }).isEnabled())
  await page.getByRole('button', { name: 'Remove sample.png', exact: true }).click()
  assert.equal(await preview.count(), 0)
  for (const hash of ['', '#c=test']) {
    await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/${hash}`)
    await page.getByRole('button', { name: 'Attach files', exact: true }).waitFor()
    await page.locator('main input[type="file"][multiple]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: Buffer.from('image') })
    await page.getByRole('img', { name: 'sample.png', exact: true }).waitFor()
    assert.ok((await page.locator('textarea').inputValue()).includes('uploads/sample.png'))
  }
  console.log('PASS: session selection retained, previewed, sendable, removable; home and chat uploads previewed')
} finally { await browser.close() }
