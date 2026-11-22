import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { wrapProjectMemory } from '../../server/extensions/lib/context-policy.mjs'

const user = { id: 'u', username: 'Tester', role: 'user' }
const memory = 'Remember the deployment plan.'
const prompt = 'Check the checklist.'
const raw = wrapProjectMemory(memory) + prompt
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } })
  page.setDefaultTimeout(6000)
  let edit
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/tenants\/[^/]+/, '')
    let body = { moves: [], requests: [], models: [], harnesses: [], projects: [], tenants: [], applets: [], sessions: [], chats: [], users: [], folders: [], interactions: [], watches: [] }
    if (path === '/api/auth/me') body = { user }
    else if (path === '/api/sessions/s') body = { session: { key: 's', harness: 'pi', path: '', access: 'owner', live: false } }
    else if (path === '/api/sessions/s/events') {
      const messages = [{ role: 'user', author: user, content: edit?.text ?? raw }]
      const state = { messages, partial: null, toolOutputs: {}, runningTools: [], running: false, live: false, queue: { steering: [], followUp: [] }, dialogs: [] }
      return route.fulfill({ contentType: 'text/event-stream', body: `data: ${JSON.stringify({ type: 'state', state })}\n\n` })
    } else if (path === '/api/sessions/s/messages/edit') {
      edit = route.request().postDataJSON()
      body = { ok: true }
    }
    await route.fulfill({ json: body })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/#s=s`)
  const pill = page.getByRole('button', { name: 'Project memory', exact: true })
  await pill.waitFor()
  assert.match(await pill.evaluate(el => getComputedStyle(el.parentElement).backgroundImage), /linear-gradient/)
  const contents = page.getByText(memory, { exact: true })
  assert.equal(await contents.isVisible(), false)
  await pill.click()
  await contents.waitFor()
  await page.getByRole('button', { name: 'Remove project memory from this message' }).click()
  await pill.waitFor({ state: 'hidden' })
  assert.deepEqual(edit, { index: 0, expect: raw, text: prompt })
  await page.getByText(prompt, { exact: true }).waitFor()
  console.log('PASS: metallic memory pill expands and removes only the memory block')
} finally { await browser.close() }
