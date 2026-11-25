import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(5000)
  const user = { id: 'u1', username: 'Tester', role: 'user' }
  const people = [{ id: 'a', username: 'Alice' }, { id: 's', username: 'Sam' }]
  let session = { key: 'test-session', access: 'owner', owner: user.username, path: '', live: true, harness: 'pi', name: 'Test session', visibility: 'private', shares: [] }
  let invited
  const chat = { id: 'test', title: 'Test chat', folder: '', pi: true, members: [user] }
  const messages = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, chatId: 'test', createdAt: new Date(1700000000000 + i * 1000).toISOString(), status: i % 2 ? 'done' : undefined, message: { role: i % 2 ? 'assistant' : 'user', author: user, content: [{ type: 'text', text: i % 2 ? `Assistant answer ${i}: @someone mentioned in history` : `User message ${i}` }] } }))
  const columns = Array.from({ length: 8 }, (_, i) => `Column ${i + 1}`)
  const table = `| ${columns.join(' | ')} |\n| ${columns.map(() => '---').join(' | ')} |\n| ${columns.map(() => 'long_token_'.repeat(20)).join(' | ')} |`
  const wideAnswer = `${table}\n\n${'unbroken'.repeat(100)}\n\n\`\`\`text\n${'long code line '.repeat(70)}\n\`\`\``
  messages[57].message.content[0].text = wideAnswer
  messages[56].message.content[0].text = 'Shared from Another chat:\n\n' + wideAnswer
  messages[54].message.content[0].text = 'long_human_message_'.repeat(120)
  const waiting = { ...messages[59], id: 61, status: 'working', sessionKey: 'pending-chat', message: { role: 'assistant', content: [], timestamp: 1700000100000 } }
  messages.push(waiting)
  // Keep the real SSE state reducer but inject later events without waiting for a reconnect.
  await page.addInitScript(({ userMessage, pendingAt }) => {
    const sources = new Map()
    const NativeEventSource = window.EventSource
    window.EventSource = class extends EventTarget {
      static OPEN = NativeEventSource.OPEN
      static CLOSED = NativeEventSource.CLOSED
      readyState = NativeEventSource.OPEN
      constructor(url, options) {
        super()
        const key = new URL(url, location.href).pathname.match(/\/sessions\/(pending-chat|pending-session)\/events$/)?.[1]
        if (!key) return new NativeEventSource(url, options)
        const streams = sources.get(key) ?? new Set()
        streams.add(this)
        sources.set(key, streams)
        this.close = () => { this.readyState = NativeEventSource.CLOSED; streams.delete(this) }
        queueMicrotask(() => {
          if (this.readyState !== NativeEventSource.OPEN) return
          this.onopen?.()
          const messages = key === 'pending-chat'
            ? [userMessage, { role: 'assistant', timestamp: pendingAt - 1, content: [{ type: 'text', text: 'A stale reply from the last turn' }] }]
            : [userMessage]
          const state = { messages, partial: null, toolOutputs: {}, runningTools: [], running: key === 'pending-session', live: true, queue: { steering: [], followUp: [] }, dialogs: [] }
          this.onmessage?.({ data: JSON.stringify({ type: 'state', state }) })
        })
      }
    }
    window.emitSession = (key, event) => {
      for (const stream of sources.get(key) ?? []) stream.onmessage?.({ data: JSON.stringify(event) })
    }
  }, { userMessage: messages[0].message, pendingAt: waiting.message.timestamp })
  async function checkMessageOverflow(expectedTables) {
    const tables = page.locator('.chat-scroll-fade .md-table')
    await tables.first().waitFor()
    assert.equal(await tables.count(), expectedTables)
    assert.deepEqual(await tables.evaluateAll(wrappers => wrappers.map(el => {
      const bubble = el.closest('.agent-message, .human-bubble')
      const scroll = el.closest('.chat-scroll-fade')
      return {
        tableScrolls: el.scrollWidth > el.clientWidth,
        bubbleFits: bubble.scrollWidth <= bubble.clientWidth + 1,
        chatFits: scroll.scrollWidth <= scroll.clientWidth + 1,
      }
    })), Array.from({ length: expectedTables }, () => ({ tableScrolls: true, bubbleFits: true, chatFits: true })))
  }
  let sent, started
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/sessions/test-session/events') {
      const state = { messages: [messages[0].message, { role: 'assistant', content: [{ type: 'text', text: 'Session assistant answer' }] }], partial: null, toolOutputs: {}, runningTools: [], running: false, live: true, queue: { steering: [], followUp: [] }, dialogs: [], name: 'Test session' }
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'state', state })}\n\n` })
    }
    if (path === '/api/sessions/test-session' || path === '/api/sessions/pending-session') body = { session }
    else if (path === '/api/sessions/test-session/participants') {
      invited = route.request().postDataJSON().userIds
      session = { ...session, visibility: 'shared', shares: people.map(p => ({ userId: p.id, username: p.username, access: 'write' })) }
      body = { session }
    }
    else if (path === '/api/sessions/test-session/prompt') { sent = route.request().postDataJSON().text }
    else if (path === '/api/auth/me') body = { user }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/chats/test/messages' && route.request().method() === 'POST') {
      sent = route.request().postDataJSON().text
      body = { message: { ...messages[0], id: 100, message: { role: 'user', author: user, content: sent } } }
    } else if (path === '/api/chats/test') body = { chat, messages }
    else if (path === '/api/chats/test/messages') body = { messages: [] }
    else if (path === '/api/jobs') body = { jobs: [{ id: 'job', name: 'Mobile job', owner: 'Tester', schedule: '@daily', folder: '', approved: false, enabled: true, canApprove: true, steps: [{ type: 'http', method: 'DELETE', url: 'https://example.com/' + 'a'.repeat(200), headers: {}, timeoutSec: 30 }], lastRun: { at: new Date().toISOString(), ok: false, ms: 10, output: 'x'.repeat(400) } }] }
    else if (path === '/api/chats' && route.request().method() === 'POST') {
      started = route.request().postDataJSON()
      body = { chat: 'test' }
    } else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/users/directory') body = { users: [user, ...people] }
    else if (path === '/api/projects') body = { projects: [] }
    else if (path === '/api/projects/moves') body = { moves: [] }
    else if (path === '/api/folders/search') body = { folders: ['my project/src'], chatFolder: 'pi-chat', entries: [{ path: 'my project/src', type: 'dir' }] }
    else if (path === '/api/harnesses') body = { harnesses: [{ id: 'pi', ok: true }] }
    else if (path.endsWith('/watches')) body = { watches: [] }
    else if (path === '/api/applets') body = { applets: [] }
    else if (path.includes('/sessions/active')) body = { sessions: [] }
    else if (path.includes('/tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('/interactions')) body = { interactions: [] }
    else if (path.includes('/models')) body = { models: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(base)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: 'Open navigation' }).click()
    await page.getByRole('button', { name: /^Scheduled jobs/ }).click()
    await page.getByLabel('Method', { exact: true }).waitFor()
    const jobs = page.getByRole('dialog', { name: 'Scheduled jobs' })
    assert.equal(await jobs.evaluate(el => [...el.querySelectorAll('*')].filter(e => e.clientWidth && getComputedStyle(e).overflowX === 'visible').every(e => e.scrollWidth <= e.clientWidth + 1)), true, 'job editor content fits mobile width')
    await jobs.getByRole('button', { name: 'Close', exact: true }).click()
    await jobs.waitFor({ state: 'hidden' })
    const navigation = page.getByRole('dialog', { name: 'Menu' })
    if (await navigation.isVisible()) await navigation.getByRole('button', { name: 'Close', exact: true }).click()
  }
  const editor = page.locator('[data-chat-composer] textarea')
  const placeholder = 'Message Beezy… ($ files, @ participants)'
  await page.getByPlaceholder(placeholder, { exact: true }).waitFor()
  const dropup = page.locator('[data-suggestions]')
  await editor.fill('$src')
  await dropup.getByText('Choose folder', { exact: true }).waitFor()
  await dropup.getByRole('option', { name: '/my project/src' }).tap()
  await editor.fill('Check /tmp and $50')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.getByText('Assistant answer 59:', { exact: false }).waitFor()
  assert.equal(started.folder, 'my project/src', 'chosen folder is sent separately from the text')
  assert.equal(started.text, 'Check /tmp and $50')
  assert.equal(await editor.getAttribute('placeholder'), placeholder, 'group chat uses the same placeholder as home')
  await editor.fill('$src')
  await dropup.getByText('Choose folder', { exact: true }).waitFor()
  await dropup.getByRole('option', { name: '/my project/src' }).tap()
  assert.equal(await editor.inputValue(), '`my project/src/` ', 'group chat also inserts a path with $')
  await editor.fill('')
  for (const width of [320, 390, 1024, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await checkMessageOverflow(2)
  }
  async function checkBusyBee(key, streamedText) {
    const buzz = page.getByRole('status', { name: 'Beezy is working' })
    await buzz.waitFor()
    const { color, padding, beeWidth, bubbleWidth } = await buzz.evaluate(el => {
      const pre = el.querySelector('pre')
      const bubble = el.closest('.agent-message')
      const style = getComputedStyle(bubble)
      return { color: getComputedStyle(pre).color, padding: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight), beeWidth: pre.offsetWidth, bubbleWidth: bubble.offsetWidth }
    })
    assert.equal(color, 'rgb(255, 255, 255)', 'bee is white in dark mode')
    assert.ok(Math.abs(bubbleWidth - beeWidth - padding) <= 1, 'loading bubble fits the bee plus its padding')
    await page.evaluate(({ key, streamedText }) => window.emitSession(key, { type: 'partial', partial: { role: 'assistant', timestamp: Date.now(), content: [{ type: 'text', text: streamedText }] } }), { key, streamedText })
    await page.locator('.agent-message').filter({ hasText: streamedText.split('\n')[0] }).first().waitFor()
    await buzz.waitFor({ state: 'hidden' })
  }
  await page.emulateMedia({ colorScheme: 'dark' })
  await checkBusyBee('pending-chat', 'Group answer has started streaming')
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
  const mention = page.getByRole('button', { name: 'Mention participants' })
  for (const name of [/Alice/, /Sam/]) {
    await mention.tap()
    await page.getByRole('option', { name }).tap()
  }
  await editor.pressSequentially('Come chat')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-chat-composer] textarea')?.value === '')
  assert.equal(sent, '@Alice @Sam Come chat', 'a group message only invokes Beezy when addressed')
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
  await page.evaluate(() => { delete window.visualViewport.height })
  await page.goto(`${base}/#s=test-session`)
  await page.getByText('Session assistant answer', { exact: true }).waitFor()
  assert.equal(await editor.getAttribute('placeholder'), placeholder, 'session uses the same placeholder as home')
  await editor.fill('$src')
  await dropup.getByText('Choose folder', { exact: true }).waitFor()
  await dropup.getByRole('button', { name: '/my project/src' }).tap()
  await page.getByRole('button', { name: 'Remove my project/src/' }).waitFor()
  await page.getByRole('button', { name: 'Remove my project/src/' }).tap()
  await page.getByRole('button', { name: 'Reply to message', exact: true }).last().click()
  await page.getByRole('region', { name: 'Reply preview' }).waitFor()
  await page.locator('[data-chat-composer] textarea').fill('Session follow-up')
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="Reply preview"]'))
  assert.equal(sent, 'Replying to Beezy:\n> Session assistant answer\n\nSession follow-up')
  assert.equal(await page.evaluate(() => window.scrollY), 0)
  for (const name of [/Beezy/, /Alice/, /Sam/]) {
    await mention.tap()
    await page.getByRole('option', { name }).tap()
  }
  await editor.pressSequentially('Join this session')
  assert.equal(await editor.inputValue(), '@pi @Alice @Sam Join this session')
  const verifyShare = (accept) => async (dialog) => {
    assert.match(dialog.message(), /@Alice, @Sam.*read the entire session/)
    await (accept ? dialog.accept() : dialog.dismiss())
  }
  page.once('dialog', verifyShare(false))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  assert.equal(invited, undefined)
  assert.equal(await editor.inputValue(), '@pi @Alice @Sam Join this session')
  page.once('dialog', verifyShare(true))
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[data-chat-composer] textarea')?.value === '')
  assert.deepEqual(invited, ['a', 's'])
  assert.equal(sent, '@pi @Alice @Sam Join this session')
  await page.goto(`${base}/#s=pending-session`)
  await checkBusyBee('pending-session', `Session answer has started streaming\n\n${wideAnswer}`)
  await checkMessageOverflow(1)

  const profile = page.locator('header').getByRole('button', { name: 'Profile and settings' })
  await profile.tap()
  await page.getByRole('menuitem', { name: 'Language' }).tap()
  await page.getByRole('menuitemradio', { name: 'Magyar' }).tap()
  await page.getByRole('button', { name: 'Profil és beállítások' }).waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'hu')
  await page.getByPlaceholder('Írj Beezynek… ($ fájlok, @ résztvevők)', { exact: true }).waitFor()
  // Localized controls and dialogs update immediately, without translating conversation content.
  await page.getByRole('button', { name: 'Menü megnyitása' }).tap()
  const menu = page.getByRole('dialog', { name: 'Menü' })
  await menu.getByRole('button', { name: 'Ütemezett feladatok (1 jóváhagyásra vár)' }).tap()
  const hungarianJobs = page.getByRole('dialog', { name: 'Ütemezett feladatok' })
  await hungarianJobs.getByText('Ütemezés', { exact: true }).waitFor()
  await hungarianJobs.getByRole('button', { name: 'Bezárás' }).tap()
  await menu.getByRole('button', { name: 'Továbbiak' }).tap()
  await page.getByRole('menuitem', { name: 'Modellbeállítások' }).focus()
  await page.keyboard.press('Enter')
  const settings = page.getByRole('dialog', { name: 'Modell beállításai' })
  await settings.getByText('Alapértelmezések és szolgáltatók').waitFor()
  await settings.getByRole('button', { name: 'Bezárás' }).tap()
  await page.getByText('Session answer has started streaming').waitFor()
  await page.reload()
  await page.getByRole('button', { name: 'Profil és beállítások' }).tap()
  await page.getByRole('menuitem', { name: 'Nyelv' }).tap()
  const magyar = page.getByRole('menuitemradio', { name: 'Magyar' })
  assert.equal(await magyar.getAttribute('aria-checked'), 'true')
  await page.getByRole('menuitemradio', { name: 'English' }).tap()
  await profile.waitFor()
  assert.equal(await page.locator('html').getAttribute('lang'), 'en')
  console.log('PASS: responsive messages, streaming bees, language switching and persistence, and mobile chat interactions')
} finally { await browser.close() }
