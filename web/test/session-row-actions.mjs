import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
  let deleted = false
  let moved
  const row = { kind: 'session', id: 'pi:test', title: 'Desktop session', folder: 'chat', harness: 'pi', projectId: 'general', canMove: true, canDelete: true, updatedAt: new Date().toISOString() }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = { tools: [], resources: [], commands: [], models: [], harnesses: [], users: [], entries: [], folders: [], chatFolder: 'chat' }
    if (path === '/api/auth/me') body = { user: { id: 'owner', username: 'andris', role: 'admin' }, tenantId: 'work' }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/projects') body = { projects: [{ id: 'general', name: 'General', general: true, folder: '' }, { id: 'project2', name: 'Other project', folder: 'other' }] }
    else if (path === '/api/projects/moves') body = { moves: [] }
    else if (path === '/api/projects/move') { moved = route.request().postDataJSON(); body = { moved: true } }
    else if (path === '/api/chats') body = { chats: deleted ? [] : [row] }
    else if (path === '/api/jobs') body = { jobs: [] }
    else if (path === '/api/sessions/pi%3Atest') {
      if (route.request().method() === 'DELETE') { deleted = true; body = { ok: true } }
      else body = { session: { key: row.id, name: row.title, harness: 'pi', access: 'owner', live: false, running: false, path: row.folder } }
    } else if (path.includes('/sessions/')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(base)
  const actions = page.getByRole('button', { name: 'Actions for Desktop session', exact: true })
  await actions.waitFor()
  assert.equal(await page.getByPlaceholder('Search chats', { exact: true }).count(), 0)
  await page.getByRole('button', { name: 'Search chats', exact: true }).click()
  const search = page.getByRole('textbox', { name: 'Search chats', exact: true })
  assert.equal(await search.evaluate(el => el === document.activeElement), true)
  await search.fill('no-match')
  await actions.waitFor({ state: 'hidden' })
  await search.press('Escape')
  await actions.waitFor()
  await actions.click()
  await page.getByRole('menuitem', { name: 'Move to project', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  await page.getByRole('button', { name: 'Other project', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual(moved, { kind: 'session', id: 'pi:test', to: 'project2' })
  await actions.click()
  await page.getByRole('menuitem', { name: 'Delete', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  assert.equal(deleted, false, 'opening the menu must not delete without confirmation')
  await dialog.getByRole('button', { name: /Delete/ }).click()
  await actions.waitFor({ state: 'hidden' })
  assert.equal(deleted, true)
  console.log('PASS: desktop search toggle/focus/filter/Escape, row menu, move and confirmed deletion')
} finally { await browser.close() }
