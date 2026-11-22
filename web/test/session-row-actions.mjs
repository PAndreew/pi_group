import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 }, serviceWorkers: 'block' })
  let deleted = []
  let moved
  const row = { kind: 'session', id: 'pi:test', title: 'Desktop session', folder: 'chat', harness: 'pi', projectId: 'general', canMove: true, canDelete: true, updatedAt: new Date().toISOString() }
  const rows = [row, { ...row, id: 'pi:second', title: 'Second session' },
    { ...row, id: 'pi:running', title: 'Running session', running: true },
    { ...row, id: 'pi:viewed', title: 'Viewed session', deleteBlockedReason: 'Someone is viewing this session' },
    { ...row, id: 'pi:memory', title: 'Consolidating session', deleteBlockedReason: 'Memory consolidation is in progress' },
    { ...row, id: 'pi:peer', title: 'Read-only session', canDelete: false }]
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = { tools: [], resources: [], commands: [], models: [], harnesses: [], users: [], entries: [], folders: [], applets: [], links: [], chatFolder: 'chat' }
    if (path === '/api/auth/me') body = { user: { id: 'owner', username: 'andris', role: 'admin' }, tenantId: 'work' }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/projects') body = { projects: [{ id: 'general', name: 'General', general: true, folder: '', links: [] }, { id: 'project2', name: 'Other project', folder: 'other', links: [] }] }
    else if (path === '/api/projects/moves') body = { moves: [] }
    else if (path === '/api/projects/move') { moved = route.request().postDataJSON(); body = { moved: true } }
    else if (path === '/api/chats') body = { chats: rows.filter(item => !deleted.includes(item.id)) }
    else if (path === '/api/jobs') body = { jobs: [] }
    else if (path === '/api/sessions/batch-delete') { deleted = route.request().postDataJSON().keys; body = { deleted, skipped: [] } }
    else if (path.includes('/sessions/')) body = { sessions: [] }
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
  const first = page.getByRole('checkbox', { name: 'Select Desktop session for deletion', exact: true })
  await first.waitFor()
  assert.equal(await dialog.count(), 0)
  assert.equal(await page.getByRole('button', { name: 'Delete selected' }).isDisabled(), true)
  for (const title of ['Running', 'Viewed', 'Consolidating', 'Read-only']) {
    assert.equal(await page.getByRole('checkbox', { name: new RegExp(`Select ${title} session`) }).isDisabled(), true)
  }
  await first.check()
  await page.getByRole('checkbox', { name: 'Select Second session for deletion', exact: true }).check()
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await dialog.getByText('Delete 2 sessions?').waitFor()
  assert.deepEqual(deleted, [], 'nothing is deleted before confirmation')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await first.isChecked(), true, 'canceling confirmation preserves the selection')
  await page.getByRole('button', { name: 'Delete selected' }).click()
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(deleted, [row.id, 'pi:second'])
  assert.equal(await actions.count(), 0)
  console.log('PASS: search, move, protected checkboxes, and confirmed batch deletion')
} finally { await browser.close() }
