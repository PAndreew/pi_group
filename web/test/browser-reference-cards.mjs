import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(6000)
  const user = { id: 'u1', username: 'Tester', role: 'user' }
  const chat = { id: 'test', title: 'Test chat', folder: 'work/app', members: [user] }
  const text = [
    '21 — chosen from an open browser', '',
    'Referenced page elements (picked in the shared browser):',
    '1. On https://news.ycombinator.com/ (Hacker News), screenshot picked-123-1.png:',
    '   - `span.titleline > a` "Nvidia Reinstates Jensen Huang as CEO" at 38,111 268×16',
    '     `<a>Private markup</a>`',
    '2. On https://news.ycombinator.com/ (Hacker News):',
    '   - `#comments` "21 comments" at 38,129 55×12',
    '     `<a>21 comments</a>`', '',
    'Attached files (relative to the working directory):',
    '- ../uploads/picked-123-1.png', '- ../uploads/other.png',
  ].join('\n')
  const messages = [{ id: 1, chatId: chat.id, createdAt: new Date().toISOString(), message: { role: 'user', author: user, content: [{ type: 'text', text }] } }]
  await page.route('https://www.google.com/s2/favicons?**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="8" fill="orange"/></svg>' }))
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = {
      '/api/auth/me': { user }, '/api/tenants': { active: 'work', tenants: [{ id: 'work', name: 'Work' }] },
      '/api/chats/test': { chat, messages }, '/api/chats/test/messages': { messages: [] }, '/api/chats': { chats: [] },
      '/api/projects': { projects: [] }, '/api/projects/moves': { moves: [] }, '/api/harnesses': { harnesses: [] },
    }[path] ?? { jobs: [], applets: [], users: [], sessions: [], interactions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:15173'}/#c=test`)
  const card = page.getByLabel('Browser references')
  await page.getByText('21 — chosen from an open browser', { exact: true }).waitFor()
  const source = card.getByRole('link', { name: /Hacker News/ })
  await source.locator('img:not(.opacity-0)').waitFor()
  assert.equal(await source.count(), 1, 'same-page picks share a header')
  assert.equal(await source.getAttribute('href'), 'https://news.ycombinator.com/')
  await card.getByText('“Nvidia Reinstates Jensen Huang as CEO”', { exact: true }).waitFor()
  await card.getByText('“21 comments”', { exact: true }).waitFor()
  const screenshot = card.getByRole('link', { name: 'View screenshot' })
  assert.equal(new URL(await screenshot.getAttribute('href'), page.url()).searchParams.get('path'), 'work/uploads/picked-123-1.png')
  assert.equal(await screenshot.getAttribute('target'), '_blank')
  assert.equal(await page.getByRole('button', { name: /Show picked-/ }).count(), 0, 'pick screenshot is not duplicated in the gallery')
  await page.getByRole('button', { name: 'Show other.png full screen' }).waitFor()
  assert.equal(await card.getByText('span.titleline > a', { exact: true }).isVisible(), false)
  await card.getByText('Details', { exact: true }).first().click()
  await card.getByText('span.titleline > a', { exact: true }).waitFor()
  await card.getByText('38,111 268×16', { exact: true }).waitFor()
  assert.equal(await page.getByText('Private markup', { exact: false }).count(), 0)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  console.log('PASS: grouped browser reference cards, screenshot links, and collapsed details on mobile')
} finally { await browser.close() }
