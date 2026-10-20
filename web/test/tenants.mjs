import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1100, height: 800 }, serviceWorkers: 'block' })
  const errors = []
  page.on('pageerror', error => errors.push(error.stack))
  let active = 'work'
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = { user: { id: 'owner', username: 'andris', role: 'admin' }, tenantId: active }
    else if (path === '/api/tenants/switch') {
      assert.equal(route.request().headers()['x-pi-tenant'], 'work')
      active = route.request().postDataJSON().id
    } else if (path === '/api/tenants') body = { active, tenants: [{ id: 'work', name: 'Work' }, { id: 'family', name: 'Family' }] }
    else if (path === '/api/chats/work-chat') body = { chat: { id: 'work-chat', title: 'Work discussion', members: [], folder: '' }, messages: [{ id: 1, createdAt: '2026-10-18', message: { role: 'user', content: 'Work private text' } }] }
    else if (path === '/api/chats/work-chat/messages') body = { messages: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/jobs') body = { jobs: [] }
    else if (path === '/api/users/directory') body = { users: [] }
    else if (path === '/api/folders/search') body = { folders: [], entries: [], chatFolder: 'chat' }
    else if (path === '/api/fs/info') body = { root: '/', rootName: active }
    else if (path === '/api/fs/list') body = { entries: [], path: '' }
    else if (path === '/api/harnesses') body = { harnesses: [] }
    else if (path.includes('/tools')) body = { tools: [], resources: [], commands: [] }
    else if (path.includes('/models')) body = { models: [] }
    else if (path.includes('/mcp')) body = { servers: [] }
    else if (path.includes('/sessions/')) body = { sessions: [], counts: {} }
    await route.fulfill({ json: body })
  })
  await page.goto(`${base}/#c=work-chat`)
  await page.getByText('Work private text', { exact: true }).waitFor()
  await page.locator('[data-chat-composer] textarea').fill('Unsent Work draft')
  await page.getByLabel('Tenant', { exact: true }).selectOption('family')
  await page.waitForFunction(() => location.hash === '' && localStorage.getItem('pi-group:tenant') === 'family')
  await page.getByLabel('Tenant', { exact: true }).waitFor()
  assert.equal(await page.getByLabel('Tenant', { exact: true }).inputValue(), 'family')
  assert.equal(await page.getByText('Work private text', { exact: true }).count(), 0)
  assert.ok(!(await page.locator('body').innerText()).includes('Work discussion'))
  assert.equal(await page.locator('textarea').first().inputValue(), '')
  assert.deepEqual(errors, [])
  console.log('PASS: switching tenants clears the route, old conversation and draft; scoped API requests')
} finally { await browser.close() }
