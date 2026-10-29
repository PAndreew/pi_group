import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 844 }, isMobile: true, hasTouch: true })
  page.on('pageerror', error => console.error(error.message))
  const long = 'very_long_unbroken_mcp_identifier_'.repeat(15)
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = { folders: [], sessions: [], chats: [], users: [], projects: [], moves: [] }
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/projects') body = { projects: [{ id: 'general', name: 'General', general: true, folder: '', links: [] }] }
    else if (path.includes('folders')) body = { folders: ['demo space'], chatFolder: 'pi-chat' }
    else if (path === '/api/tools') body = { tools: [{ name: long, origin: long, description: long }], commands: [{ name: long, source: 'extension', description: long }], resources: [] }
    else if (path === '/api/mcp') body = { servers: [{ name: long, target: `npx ${long}`, enabled: true, state: 'connected', tools: [long] }], live: true }
    else if (path === '/api/tenants') body = { tenants: [] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path.includes('sessions')) body = { sessions: [] }
    else if (path.includes('harnesses')) body = { harnesses: [] }
    else if (path.includes('jobs')) body = { jobs: [] }
    else if (path.includes('applets')) body = { applets: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8788/')
  const editor = page.getByPlaceholder('Message: @someone and $folder')
  await editor.fill('$demo')
  await page.getByRole('listbox').getByRole('button', { name: '/demo space', exact: true }).click()
  assert.equal(await editor.inputValue(), '$demo\u00a0space ')
  await editor.fill('#demo')
  await page.waitForTimeout(250)
  assert.equal(await page.getByRole('listbox').count(), 0, 'hash no longer triggers folder suggestions')
  assert.match(await page.getByRole('navigation', { name: 'Projects' }).locator('button').evaluate(el => getComputedStyle(el).fontFamily), /Lato/)
  await editor.fill('')
  await page.getByRole('button', { name: 'Open navigation' }).click()
  await page.getByRole('button', { name: 'Tools, skills, commands & MCP', exact: true }).click()
  const modal = page.locator('.tools-dialog')
  await modal.getByText(`npx ${long}`, { exact: true }).waitFor()
  await modal.getByRole('button', { name: /connected|1 tools/ }).click()
  const overflow = await modal.evaluate(el => [...el.querySelectorAll('*')].filter(n => n.clientWidth && !n.classList.contains('sr-only') && n.scrollWidth > n.clientWidth + 1).map(n => ({ tag: n.tagName, class: n.className })))
  assert.deepEqual(overflow, [], 'long names, commands and badges must wrap without horizontal overflow')
  console.log('PASS: long tools and MCP commands wrap at 320px')
} finally { await browser.close() }
