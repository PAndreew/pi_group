import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const user = { id: 'u1', username: 'Tester', role: 'user' }
  const chat = { id: 'test', title: 'Test chat', folder: '', pi: true, members: [user] }
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, chatId: 'test', createdAt: new Date(1700000000000 + i * 1000).toISOString(), status: i % 2 ? 'done' : undefined, message: { role: i % 2 ? 'assistant' : 'user', author: user, content: [{ type: 'text', text: i % 2 ? `Assistant answer ${i}: @someone mentioned in history` : `User message ${i}` }] } }))
  let sent
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/sessions/test-session/events') {
      const state = { messages: [messages[0].message, { role: 'assistant', content: [{ type: 'text', text: 'Session assistant answer' }] }], partial: null, toolOutputs: {}, runningTools: [], running: false, live: true, queue: { steering: [], followUp: [] }, dialogs: [], name: 'Test session' }
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'state', state })}\n\n` })
    }
    if (path === '/api/sessions/test-session') body = { session: { key: 'test-session', access: 'owner', path: '', live: true, harness: 'pi', name: 'Test session' } }
    else if (path === '/api/sessions/test-session/prompt') { sent = route.request().postDataJSON().text }
    else if (path === '/api/auth/me') body = { user }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/chats/test/messages' && route.request().method() === 'POST') {
      sent = route.request().postDataJSON().text
      body = { message: { ...messages[0], id: 100, message: { role: 'user', author: user, content: sent } } }
    } else if (path === '/api/chats/test') body = { chat, messages }
    else if (path === '/api/chats/test/messages') body = { messages: [] }
    else if (path === '/api/jobs') body = { jobs: [{ id: 'job', name: 'Mobile job', owner: 'Tester', schedule: '@daily', folder: '', approved: false, enabled: true, canApprove: true, steps: [{ type: 'http', method: 'DELETE', url: 'https://example.com/' + 'a'.repeat(200), headers: {}, timeoutSec: 30 }], lastRun: { at: new Date().toISOString(), ok: false, ms: 10, output: 'x'.repeat(400) } }] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/users/directory') body = { users: [user] }
    else if (path.includes('/sessions/active')) body = { sessions: [] }
    else if (path.includes('/tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('/interactions')) body = { interactions: [] }
    else if (path.includes('/models')) body = { models: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${base}/#c=test`)
  await page.getByText('Assistant answer 59:', { exact: false }).waitFor()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: /^Scheduled jobs/ }).click()
    await page.getByLabel('Method', { exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog').evaluate(el => [...el.querySelectorAll('*')].filter(e => e.clientWidth && getComputedStyle(e).overflowX === 'visible').every(e => e.scrollWidth <= e.clientWidth + 1)), true, 'job editor content fits mobile width')
    await page.keyboard.press('Escape')
  }
  const spacing = await page.locator('[data-composer-box] > div').last().evaluate(el => ({ top: getComputedStyle(el).paddingTop, bottom: getComputedStyle(el).paddingBottom }))
  assert.equal(spacing.top, spacing.bottom, 'send row has equal spacing above and below')
  const scroller = page.locator('div.overflow-y-auto').last()
  await scroller.evaluate(el => { el.scrollTop = el.scrollHeight / 2 })
  await page.evaluate(() => {
    // Reproduce overflow/focus-driven layout viewport movement on mobile.
    const overflow = document.createElement('div')
    overflow.style.cssText = 'position:absolute;top:1200px;height:10px;width:10px;background:red'
    document.body.append(overflow)
    window.scrollTo(0, 150)
  })
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'document moves navbar and composer with chat')
  const header = page.locator('header:visible')
  const top = (await header.boundingBox()).y
  await scroller.evaluate(el => { el.scrollTop = 0 })
  assert.equal((await header.boundingBox()).y, top)
  await page.getByRole('button', { name: 'Reply to message', exact: true }).nth(1).click()
  await page.getByRole('region', { name: 'Reply preview' }).waitFor()
  const editor = page.locator('[data-chat-composer] textarea')
  assert.equal(await editor.evaluate(el => el === document.activeElement), true)
  await editor.fill('My question')
  await page.getByRole('button', { name: 'Cancel reply' }).click()
  assert.equal(await editor.inputValue(), 'My question')
  await page.getByRole('button', { name: 'Reply to message', exact: true }).nth(1).click()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Reply preview"]'))
  assert.ok(sent.startsWith('@pi Replying to Beezy:'))
  assert.match(sent, /> Assistant answer 1/)
  assert.ok(sent.endsWith('My question'))
  assert.ok(!sent.includes('@someone'), 'quoted mentions must not invite participants')
  for (const height of [420, 844, 390]) {
    await page.setViewportSize({ width: 390, height })
    await editor.focus()
    await page.waitForTimeout(100)
    const box = await editor.boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= height + 1, 'composer stays on screen')
    assert.equal(await page.evaluate(() => window.scrollY), 0)
  }
  await editor.blur()
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, 'height', { configurable: true, value: 200 })
    Object.defineProperty(window.visualViewport, 'offsetTop', { configurable: true, value: 80 })
    window.dispatchEvent(new Event('pageshow'))
  })
  await page.waitForTimeout(150)
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-height')), '390px', 'unfocused resumed app ignores stale keyboard viewport')
  assert.equal(await page.evaluate(() => document.documentElement.style.getPropertyValue('--app-top')), '0px')
  await page.goto(`${base}/#s=test-session`)
  await page.getByText('Session assistant answer', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Reply to message', exact: true }).last().click()
  await page.getByRole('region', { name: 'Reply preview' }).waitFor()
  await page.locator('[data-chat-composer] textarea').fill('Session follow-up')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Reply preview"]'))
  assert.equal(sent, 'Replying to Beezy:\n> Session assistant answer\n\nSession follow-up')
  assert.equal(await page.evaluate(() => window.scrollY), 0)
  console.log('PASS: group and session replies; cancel/send; quoted mention safety; mobile scroll/resize/focus')
} finally { await browser.close() }
