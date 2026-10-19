import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  const user = { id: 'u', username: 'Tester', role: 'user' }
  const createdAt = '2026-01-01T00:00:00.000Z'
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = { user }
    else if (path === '/api/chats/test') body = { chat: { id: 'test', folder: '', pi: true, sessionKey: 's', members: [user] }, messages: [{ id: 1, createdAt, status: 'working', message: { role: 'assistant', content: [] } }] }
    else if (path.endsWith('/interactions')) body = { interactions: [{ id: 'card', sessionKey: 's', toolCallId: 't', createdAt, status: 'pending', spec: { title: 'Choose a path', type: 'single_choice', options: Array.from({ length: 30 }, (_, i) => ({ id: `${i}`, label: `Option ${i}` })) } }] }
    else if (path === '/api/sessions/s') body = { session: { harness: 'pi' } }
    else if (path.endsWith('/models')) body = { models: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path.endsWith('/messages')) body = { messages: [] }
    else if (path.includes('/tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('/sessions')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:8788'}/#c=test`)
  const card = page.getByRole('region', { name: 'Choose a path' })
  await card.waitFor()
  assert.ok(await card.evaluate(el => el.parentElement.parentElement.classList.contains('bg-card')), 'interaction belongs inside agent bubble')
  const bounds = await card.boundingBox()
  assert.ok(bounds.height <= 423, 'long card has bounded height')
  assert.ok(await card.evaluate(el => el.scrollHeight > el.clientHeight), 'long card scrolls internally')
  assert.equal(await page.locator('[data-chat-composer] section').count(), 0)
  console.log('PASS: interaction nested inside agent bubble; long forms bounded and internally scrollable')
} finally { await browser.close() }
