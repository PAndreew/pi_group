import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const long = 'Quarterly_Supplier_Agreement_Final_Revision_With_Legal_Comments_And_Tracked_Changes_2026-11-18.docx'
const spec = {
  slug: 'docx-translator', title: 'DOCX translator', description: 'Translate Word documents.',
  fields: [
    { type: 'file', id: 'files', label: 'Documents', accept: ['.docx'], multiple: true },
    { type: 'select', id: 'target', label: 'Target language', options: ['English', 'German'], default: 'English' },
  ],
  actions: [
    { id: 'run', label: 'Translate', prompt: 'Translate {{files}} into {{target}}.' },
    { id: 'guide', label: 'Open guide', type: 'open_url', url: 'https://example.com/guide' },
    { id: 'copy', label: 'Copy template', type: 'copy_text', text: 'Literal {{text}}' },
    { id: 'reset', label: 'Reset', type: 'reset_form' },
  ],
}
const applet = { id: 'a1', slug: 'docx-translator', title: 'DOCX translator', description: spec.description, folder: 'work', owner: 'u', version: 1, approved: true, hasDraft: false, canManage: true, createdAt: '', updatedAt: '', spec }
const runs = [{ id: 'r1', action: 'run', status: 'finished', startedAt: new Date().toISOString(), values: { files: [`uploads/${long}`], target: 'German' }, output: `Done: [${long.replace('.docx', '_DE.docx')}](uploads/${long.replace('.docx', '_DE.docx')}) and \`uploads/${long}\`` }]
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 375, height: 800 } })
  let agentRuns = 0
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace(/\/tenants\/[^/]+/, '')
    let body = { moves: [], requests: [], models: [], harnesses: [], projects: [{ id: 'general', name: 'General', general: true, folder: '', links: [] }], tenants: [], jobs: [], applets: [applet], sessions: [], users: [], folders: [], chatFolder: 'pi-chat' }
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/applets/docx-translator') body = { applet, runs }
    else if (path === '/api/applets/a1/run') agentRuns++
    else if (path === '/api/fs/upload') body = { files: [{ path: `work/uploads/${long}` }] }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path.includes('/sessions')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/#app=docx-translator`)
  const translate = page.getByRole('button', { name: 'Translate' })
  await translate.waitFor()
  assert.ok(await translate.isDisabled(), 'prompt button requires a document')
  const guide = page.getByRole('link', { name: 'Open guide' })
  assert.equal(await guide.getAttribute('href'), 'https://example.com/guide')
  assert.equal(await guide.getAttribute('target'), '_blank')
  await page.getByRole('button', { name: 'Copy template' }).click()
  await page.getByText('Copied', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'Literal {{text}}')
  await page.locator('input[type="file"][accept=".docx"]').setInputFiles({ name: long, mimeType: 'application/octet-stream', buffer: Buffer.from('x') })
  await page.getByRole('button', { name: new RegExp(`^Remove .*${long}`) }).waitFor({ timeout: 3000 })
  const overflow = await page.evaluate(() => {
    const vw = document.documentElement.clientWidth
    const wide = [...document.querySelectorAll('main *, [data-slot] *')].filter(el => el.getBoundingClientRect().right > vw + 1 && !el.closest('[class*="overflow-x-auto"], pre'))
    const scrollers = [...document.querySelectorAll('*')].filter(el => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'hidden' && getComputedStyle(el).overflowX !== 'visible' && !el.closest('pre'))
    return { vw, wide: wide.slice(0, 5).map(el => `${el.tagName}.${el.className}`.slice(0, 120)), scrollers: scrollers.slice(0, 5).map(el => `${el.tagName}.${el.className}`.slice(0, 120)), pageWide: document.documentElement.scrollWidth > vw }
  })
  assert.deepEqual(overflow, { vw: overflow.vw, wide: [], scrollers: [], pageWide: false }, JSON.stringify(overflow, null, 2))
  assert.ok(await translate.isEnabled())
  await page.getByRole('button', { name: 'Reset' }).click()
  assert.ok(await translate.isDisabled(), 'reset clears the uploaded selection')
  assert.equal(agentRuns, 0)
  console.log('PASS: applet fits a 375px screen; link, copy and reset do not start agent runs')
} finally { await browser.close() }
