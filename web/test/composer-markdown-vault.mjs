import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(6000)
  const token = `ghp_${'A2'.repeat(18)}`
  const writes = []
  let failSave = true
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/vault/secrets/API_TOKEN_2') && request.method() === 'PUT') {
      writes.push(request.postDataJSON())
      return route.fulfill(failSave ? { status: 503, json: {} } : { json: { key: 'API_TOKEN_2' } })
    }
    if (url.pathname.endsWith('/vault/secrets')) return route.fulfill({ json: { secrets: [{ key: 'API_TOKEN' }] } })
    return route.fulfill({ json: { users: [], folders: [] } })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/test/fixtures/folder-composer.html`)
  const input = page.locator('[data-composer-box] textarea')
  const sent = page.locator('[data-sent]')
  const preview = page.locator('[data-composer-box] .prose-pi')
  const plain = 'Just a plain message.\n\nAnother paragraph.'
  await input.fill(plain)
  await preview.waitFor({ state: 'hidden' })
  assert.ok(!(await preview.allTextContents()).join('').includes(plain.split('\n')[0]))
  assert.equal(await input.inputValue(), plain)
  const draft = `**Report**\n\n| File |\n| --- |\n| \`uploads/report.xlsx\` |\n\nUse ${token}`
  await input.fill(draft)
  assert.equal(await page.getByRole('button', { name: /markdown/i }).count(), 0, 'rendering has no toggle')
  await preview.locator('table .file-icon').waitFor()
  await input.fill(plain)
  await preview.waitFor({ state: 'hidden' })
  await input.fill(draft)
  await preview.locator('table .file-icon').waitFor()
  assert.equal(await preview.locator('strong').textContent(), 'Report')
  assert.ok(!(await preview.textContent()).includes(token))
  assert.ok(await input.evaluate(el => document.activeElement === el), 'rendering keeps editor focus')

  await input.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Secret vault' })
  await dialog.waitFor()
  assert.equal(await sent.textContent(), '')
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await input.inputValue(), draft)
  assert.equal(writes.length, 0)

  await page.getByRole('button', { name: 'Send', exact: true }).click()
  const save = dialog.getByRole('button', { name: 'Save', exact: true })
  await save.click()
  assert.equal(await save.isVisible(), true)
  assert.equal(await input.inputValue(), draft)
  assert.equal(await sent.textContent(), '')
  failSave = false
  await save.click()
  await dialog.waitFor({ state: 'hidden' })
  assert.deepEqual(writes, [{ description: '', value: token }, { description: '', value: token }])
  const reference = '{' + '{vault:API_TOKEN_2}}'
  assert.equal(await input.inputValue(), draft.replace(token, reference))
  assert.equal(await sent.textContent(), '', 'saving never submits')
  await input.press('Enter')
  await sent.locator('table .file-icon').waitFor({ state: 'attached' })
  await preview.waitFor({ state: 'detached' })
  assert.ok((await sent.textContent()).includes(reference))
  assert.ok(!(await sent.textContent()).includes(token))
  console.log('PASS: shared Markdown/table/file rendering; keyboard and button block secrets; cancel and retry preserve the draft; saving replaces the secret without sending')
} finally { await browser.close() }
