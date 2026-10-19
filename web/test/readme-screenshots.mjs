// Reproducible screenshots of the real UI with fictional accounts and scripted replies.
// No backend, real credentials, account creation, or model calls are used.
// Start npm run dev:web, then: node web/test/readme-screenshots.mjs
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
const base = process.env.TEST_URL || 'http://localhost:5173'
const out = new URL('../../docs/screenshots/', import.meta.url)
await mkdir(out, { recursive: true })
const alice = { id: 'demo-alice', username: 'Alice', role: 'admin' }
const sam = { id: 'demo-sam', username: 'Sam', role: 'member' }
const chat = { id: 'demo', title: 'A weekend project', folder: 'weekend-planner', pi: true, members: [alice, sam], updatedAt: '2026-10-18T10:00:00Z' }
const turns = [
  [alice, 'Let’s build a little weekend planner. Sam, what should we start with?'],
  [sam, 'A shared list of places, with a map and a rain backup. Keep it simple!'],
  [alice, '@pi Can you turn that into a first version in this folder?'],
  [null, 'Here’s a small first version we can build together:\n\n- **Places** — add a name, link and short note.\n- **Weekend plan** — pick Saturday or Sunday.\n- **Rain backup** — keep an indoor alternative nearby.\n\nShall I start with the shared list, then add the map?'],
  [sam, 'Yes, list first. Let’s make it work nicely on our phones too.'],
]
const messages = turns.map(([author, text], i) => ({ id: i + 1, chatId: chat.id, createdAt: `2026-10-18T10:0${i}:00Z`, ...(author ? {} : { status: 'done' }), message: { role: author ? 'user' : 'assistant', ...(author ? { author } : {}), content: [{ type: 'text', text }] } }))
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 820 }, deviceScaleFactor: 1 })
  await page.addInitScript(() => localStorage.setItem('theme', 'light'))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path.endsWith('/events')) return route.fulfill({ contentType: 'text/event-stream', body: ': demo\n\n' })
    if (path === '/api/auth/me') body = { user: alice }
    else if (path === '/api/users/directory') body = { users: [alice, sam] }
    else if (path === '/api/chats/demo') body = { chat, messages }
    else if (path === '/api/chats/demo/messages') body = { messages: [] }
    else if (path === '/api/chats') body = { chats: [{ ...chat, kind: 'chat', running: false, unread: 0, last: { author: 'Sam', text: turns.at(-1)[1] } }] }
    else if (path === '/api/folders/search') body = { folders: ['weekend-planner', 'family-notes'], chatFolder: 'pi-chat' }
    else if (path === '/api/harnesses') body = { harnesses: [{ id: 'pi', label: 'pi', ok: true, durable: false, description: 'pi coding agent' }] }
    else if (path.endsWith('/models')) body = { models: [{ provider: 'anthropic', id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', reasoning: true }] }
    else if (path.includes('/tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('/interactions')) body = { interactions: [] }
    else if (path.includes('/sessions')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(base)
  await page.getByPlaceholder('Start a chat: message, @someone, #folder…').fill('@Sam @pi #weekend-planner Let’s plan something together.')
  await page.locator('textarea').press('Escape')
  await page.waitForTimeout(600)
  await page.screenshot({ path: new URL('start-chat.png', out).pathname })
  await page.setViewportSize({ width: 1100, height: 1000 })
  await page.goto(`${base}/#c=demo`)
  await page.getByText('Yes, list first.', { exact: false }).last().waitFor()
  await page.waitForTimeout(400)
  await page.screenshot({ path: new URL('group-chat.png', out).pathname })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.screenshot({ path: new URL('mobile-chat.png', out).pathname })
  await page.setViewportSize({ width: 1100, height: 820 })
  await page.goto(base)
  await page.getByRole('button', { name: /Alice/ }).click()
  await page.getByRole('menuitem', { name: 'Session defaults' }).click()
  await page.getByRole('button', { name: 'Save as my defaults' }).waitFor()
  await page.waitForTimeout(600)
  await page.screenshot({ path: new URL('session-defaults.png', out).pathname })
  console.log('Saved four demo screenshots to docs/screenshots/')
} finally { await browser.close() }
