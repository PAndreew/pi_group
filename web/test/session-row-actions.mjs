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
  const projects = [
    { id: 'general', name: 'General', general: true, folder: '', links: [], canManage: true },
    { id: 'project2', name: 'Other project', folder: 'other', links: [] },
    ...Array.from({ length: 20 }, (_, i) => ({ id: `extra-${i}`, name: `Extra project ${i + 1}`, folder: `extra-${i}`, links: [] })),
  ]
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = { tools: [], resources: [], commands: [], models: [], harnesses: [], users: [], entries: [], folders: [], applets: [], links: [], chatFolder: 'chat' }
    if (path === '/api/auth/me') body = { user: { id: 'owner', username: 'andris', role: 'admin' }, tenantId: 'work' }
    else if (path === '/api/tenants') body = { active: 'work', tenants: [{ id: 'work', name: 'Work' }] }
    else if (path === '/api/projects') body = { projects }
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
  assert.equal(await page.getByRole('button', { name: 'Go to…', exact: true }).count(), 0)
  const palette = page.getByRole('dialog', { name: 'Go to…', exact: true })
  await page.keyboard.press('Control+k')
  await palette.waitFor()
  await page.keyboard.press('Escape')
  await palette.waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'Switch project: General', exact: true }).click()
  const projectMenu = page.getByRole('menu')
  const searchAction = projectMenu.getByRole('menuitem', { name: 'Search chats', exact: true })
  const projectRows = projectMenu.getByRole('group', { name: 'Projects', exact: true })
  const firstProject = projectRows.getByRole('menuitem', { name: 'General', exact: true })
  const lastProject = projectRows.getByRole('menuitem', { name: 'Extra project 20', exact: true })
  const actionY = await searchAction.evaluate(el => el.offsetTop)
  assert.ok(await firstProject.evaluate(el => el.getBoundingClientRect().top) > await searchAction.evaluate(el => el.getBoundingClientRect().top))
  await projectMenu.getByRole('menuitem', { name: 'Share project with…', exact: true }).waitFor()
  await projectRows.hover()
  await page.mouse.wheel(0, 120)
  await page.waitForFunction(el => el.scrollTop > 0, await projectRows.elementHandle())
  await page.keyboard.press('End')
  await page.waitForFunction(el => el === document.activeElement, await lastProject.elementHandle())
  assert.ok(await projectRows.evaluate(el => el.scrollTop) > 0, 'keyboard navigation scrolls the project list')
  assert.equal(await searchAction.evaluate(el => el.offsetTop), actionY, 'actions stay in place')
  assert.equal(await projectMenu.evaluate(el => el.scrollTop), 0, 'the menu itself does not scroll')

  await searchAction.click()
  const search = page.getByRole('textbox', { name: 'Search chats', exact: true })
  await page.waitForFunction(el => el === document.activeElement, await search.elementHandle())
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
  console.log('PASS: project menu scrolling and search, palette shortcut, move, protected checkboxes, and confirmed batch deletion')
} finally { await browser.close() }
