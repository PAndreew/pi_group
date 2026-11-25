import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { wrapProjectMemory } from '../../server/extensions/lib/context-policy.mjs'

const browser = await chromium.launch()
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(6000)
  const user = { id: 'u', username: 'Tester', role: 'user' }
  const memory = 'Remember the user prefers short answers.'
  const question = 'What is on the page?'
  const answer = 'An example page with a headline.'
  const literal = String.raw`\(\sqrt{2}\)`
  const math = String.raw`\(\mathbb{R}\) includes \(\sqrt{2}\) and \(\pi\). Here is $x$.

\[
\frac{1}{2} + \frac{1}{2} = 1
\]

$$
x^2 + y^2 = z^2
$$`
  const session = { key: 's', harness: 'pi', path: 'workspace', access: 'owner', live: true }
  const messages = []
  let stream
  let running = false
  let partial = null
  const model = { provider: 'test', id: 'test', name: 'Test' }
  const state = () => ({ messages, partial, model, toolOutputs: {}, runningTools: [], running, live: true, queue: { steering: [], followUp: [] }, dialogs: [] })
  const publish = () => stream?.(JSON.stringify({ type: 'state', state: state() }))
  await page.routeWebSocket('**/api/browser?**', socket => {
    socket.send(JSON.stringify({ type: 'state', url: 'https://example.com/', title: 'Example', viewport: { width: 1280, height: 800 }, canInput: true }))
  })
  await page.exposeFunction('attachSessionEvents', () => { stream = line => page.evaluate(value => window.pushSessionEvent(value), line); return publish() })
  await page.addInitScript(() => {
    const NativeEventSource = window.EventSource
    window.EventSource = class extends EventTarget {
      static OPEN = NativeEventSource.OPEN
      static CLOSED = NativeEventSource.CLOSED
      readyState = NativeEventSource.OPEN
      constructor(url) {
        super()
        if (!url.includes('/api/sessions/s/events')) return new NativeEventSource(url)
        const listeners = window.sessionEventSources ??= new Set()
        listeners.add(this)
        window.pushSessionEvent = data => { for (const source of listeners) source.onmessage?.({ data }) }
        queueMicrotask(() => { this.onopen?.(); void window.attachSessionEvents() })
      }
      close() { this.readyState = NativeEventSource.CLOSED; window.sessionEventSources?.delete(this) }
    }
  })
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    if (path === '/api/sessions/s/prompt') {
      const request = route.request().postDataJSON()
      assert.equal(request.fromBrowser, true)
      messages.push({ role: 'user', author: user, content: wrapProjectMemory(memory) + request.text, timestamp: messages.length + 1, ...(request.fromBrowser ? { browserQuestionId: `request-${messages.length}` } : {}) })
      running = true
      await route.fulfill({ json: { ok: true } })
      await publish()
      return
    }
    const body = {
      '/api/auth/me': { user }, '/api/tenants': { active: 'work', tenants: [{ id: 'work', name: 'Work' }] },
      '/api/sessions/s': { session }, '/api/harnesses/pi/models': { models: [model] },
      '/api/chats/c': { chat: { id: 'c', title: 'Test chat', folder: 'workspace', members: [user], sessionKey: 's' }, messages: [] },
      '/api/sessions/s/browser': { open: false }, '/api/projects': { projects: [] }, '/api/projects/moves': { moves: [] },
    }[path] ?? { chats: [], jobs: [], applets: [], watches: [], users: [], sessions: [], interactions: [], folders: [], tools: [], commands: [], resources: [] }
    await route.fulfill({ json: body })
  })
  const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
  const globe = page.getByRole('button', { name: 'Shared browser', exact: true })
  const tools = page.getByRole('navigation', { name: 'Browser tools' })
  const address = page.getByRole('textbox', { name: 'URL or search keyword' })
  for (const route of ['c=c', 's=s']) {
    await page.goto(`${base}/#${route}`)
    await globe.click()
    await address.waitFor()
    const top = await tools.boundingBox()
    const bottom = await address.boundingBox()
    assert.ok(top.y <= 1 && top.width === 390 && bottom.y + bottom.height > 810, `${route}: browser must fill the phone viewport (toolbar y=${top.y})`)
    assert.equal(await tools.textContent(), '', 'the toolbar should contain icons only')
    const positions = (await tools.getByRole('button').all()).map(button => button.boundingBox())
    const centers = (await Promise.all(positions)).map(({ x, width }) => x + width / 2)
    const gaps = centers.slice(1).map((center, index) => center - centers[index])
    assert.ok(Math.max(...gaps) - Math.min(...gaps) <= 1, 'toolbar icons should be evenly spaced')
    if (route === 's=s') {
      const quote = await page.getByRole('button', { name: 'Select text' }).boundingBox()
      assert.ok(quote.x >= bottom.x + bottom.width, 'quote button should be right of the address input')
    }
    await tools.getByRole('button', { name: 'Hide browser' }).click()
    await tools.waitFor({ state: 'hidden' })
    assert.equal(await globe.isVisible(), true)
  }
  const openBrowser = async () => {
    await globe.click()
    await page.getByRole('button', { name: 'Ask about this page' }).waitFor()
  }
  const bubble = page.getByRole('region', { name: 'Browser answer' })
  await openBrowser()
  await page.getByRole('button', { name: 'Ask about this page' }).click()
  const input = page.getByRole('textbox', { name: 'Ask about this page' })
  await input.fill(question)
  await input.locator('xpath=ancestor::form').getByRole('button', { name: 'Send' }).click()
  await bubble.getByText('Running…', { exact: true }).waitFor()
  partial = { role: 'assistant', content: [{ type: 'text', text: 'An example page' }] }
  await publish()
  await bubble.getByText('An example page', { exact: true }).waitFor()
  partial = null
  messages.push({ role: 'assistant', content: [{ type: 'text', text: `${answer}\n\n${math}\n\nLiteral: \`${literal}\`` }], timestamp: 2 })
  running = false
  await publish()
  await page.getByText(answer, { exact: true }).first().waitFor()
  await page.getByText(answer, { exact: true }).nth(1).waitFor()
  await bubble.getByText(answer, { exact: true }).waitFor()
  assert.equal(await bubble.getByText('Running…').count(), 0)
  assert.equal(await page.getByText(answer, { exact: true }).count(), 2)
  for (const prose of await page.locator('.prose-pi').filter({ hasText: answer }).all()) {
    await prose.locator('.katex math msqrt').waitFor({ state: 'attached' })
    assert.equal(await prose.locator('.katex-display').count(), 2)
    assert.deepEqual(await prose.locator('.katex annotation').allTextContents(), [String.raw`\mathbb{R}`, String.raw`\sqrt{2}`, String.raw`\pi`, 'x', String.raw`\frac{1}{2} + \frac{1}{2} = 1`, 'x^2 + y^2 = z^2'])
    assert.equal(await prose.locator('code').textContent(), literal)
  }
  await page.reload()
  await openBrowser()
  await bubble.getByText(answer, { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Ask about this page' }).click()
  await input.fill(question)
  await input.locator('xpath=ancestor::form').getByRole('button', { name: 'Send' }).click()
  await bubble.getByText('Running…').waitFor()
  messages.push({ role: 'assistant', content: [], stopReason: 'aborted', timestamp: 4 })
  running = false
  await publish()
  await bubble.getByText('The run was interrupted.', { exact: true }).waitFor()
  assert.equal(await bubble.getByText('Running…').count(), 0)
  await page.getByRole('button', { name: `Question 1: ${question}` }).click()
  await bubble.getByText(answer, { exact: true }).waitFor()
  console.log('PASS: first browser question with memory, answer in both views, reload, repeated question and interruption')
} finally { await browser.close() }
