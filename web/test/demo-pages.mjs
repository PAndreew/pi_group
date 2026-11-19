// Build first: VITE_DEMO=true npm run build -- --base=/pi_group/
// Serve: npm run preview -- --host 127.0.0.1 --base=/pi_group/
// Run: node test/demo-pages.mjs
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  const errors = []
  const apiRequests = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url()) })
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:4173/pi_group/')
  await page.getByRole('heading', { name: 'Build the weekend planner' }).waitFor()
  await page.getByText('bash · npm test', { exact: true }).click()
  assert.match(await page.locator('.demo-tool[open] pre').textContent(), /5 passed/)
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Can you help?')
  await page.getByRole('button', { name: 'Send message' }).click()
  await page.getByText('Can you help?', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Browser', exact: true }).click()
  await page.getByRole('button', { name: 'Vote · 4', exact: true }).click()
  await page.getByRole('button', { name: '✓ Voted · 5', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Sunday', exact: true }).click()
  await page.getByRole('heading', { name: 'Slow morning brunch' }).waitFor()
  await page.getByRole('button', { name: 'Tools', exact: true }).click()
  await page.getByRole('textbox', { name: 'Search tools' }).fill('bash')
  assert.equal(await page.locator('.demo-grid .demo-card').count(), 1)
  await page.getByRole('button', { name: 'Resources', exact: true }).click()
  await page.getByLabel('Usage period').selectOption('30 days')
  await page.getByText('$18.62', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Accounts', exact: true }).click()
  await page.getByLabel('Display name').fill('Taylor')
  await page.getByRole('button', { name: 'Add demo account' }).click()
  await page.getByLabel('Demo account').selectOption('Taylor')
  await page.getByText('Taylor added locally. No invitation was sent.').waitFor()
  await page.getByRole('button', { name: 'New session', exact: true }).click()
  await page.getByRole('heading', { name: 'New conversation 4' }).waitFor()
  await page.reload()
  await page.getByRole('heading', { name: 'Build the weekend planner' }).waitFor()
  assert.equal(await page.getByLabel('Demo account').locator('option').count(), 3)
  await page.setViewportSize({ width: 390, height: 844 })
  for (const tab of ['Browser', 'Tools', 'Resources', 'Accounts']) {
    await page.getByRole('button', { name: tab, exact: true }).click()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${tab} must fit mobile viewport`)
  }
  assert.deepEqual(errors, [])
  assert.deepEqual(apiRequests, [])
  console.log('Demo smoke test passed (desktop, mobile, local interactions, no API calls).')
} finally {
  await browser.close()
}
