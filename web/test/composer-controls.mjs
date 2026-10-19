import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const models = [
    { provider: 'test', id: 'one', name: 'First model', reasoning: true, thinkingLevels: ['off', 'medium', 'high'] },
    { provider: 'test', id: 'two', name: 'Second model', reasoning: true, thinkingLevels: ['off', 'low', 'high', 'max'] },
  ]
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    let body = {}
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/harnesses') body = { harnesses: [{ id: 'pi', ok: true }] }
    else if (path.endsWith('/models')) body = { models }
    else if (path === '/api/chats') body = { chats: [] }
    else if (path === '/api/users/directory') body = { users: [] }
    else if (path.includes('folders')) body = { folders: [], chatFolder: 'pi-chat' }
    else if (path.includes('tools')) body = { tools: [], commands: [], resources: [] }
    else if (path.includes('sessions')) body = { sessions: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8788')
  const agent = page.getByRole('switch', { name: 'Send to agent too' })
  await agent.waitFor()
  const camera = page.getByRole('button', { name: 'Take photo' })
  assert.equal(await camera.isEnabled(), true, 'camera must work with Agent off')
  const chooser = page.waitForEvent('filechooser')
  await camera.click()
  await chooser
  await agent.click()
  const model = page.getByRole('combobox', { name: 'Current session model' })
  await model.selectOption(JSON.stringify(['test', 'two']))
  assert.equal(await model.inputValue(), JSON.stringify(['test', 'two']))
  await page.locator('textarea').focus()
  await page.getByRole('button', { name: /^Reasoning:/ }).tap()
  await page.waitForTimeout(500)
  assert.equal(await page.getByRole('dialog', { name: 'Reasoning settings' }).isVisible(), true, 'reasoning remains open after touch')
  const popup = await page.getByRole('slider', { name: 'Reasoning level', exact: true }).locator('..').boundingBox()
  const inputBox = await page.locator('textarea').boundingBox()
  assert.ok(popup.x >= 0 && popup.x + popup.width <= 390, 'reasoning popup stays inside viewport')
  assert.ok(Math.abs(popup.x + popup.width / 2 - (inputBox.x + inputBox.width / 2)) < 2, 'reasoning popup centered above input')
  assert.ok(popup.y + popup.height <= inputBox.y, 'reasoning popup above input')
  await page.getByRole('slider', { name: 'Reasoning level', exact: true }).fill('3')
  await page.getByRole('button', { name: 'Reasoning: max', exact: true }).waitFor()
  const center = await model.evaluate(el => {
    const r = el.getBoundingClientRect(), p = el.closest('[data-chat-composer]')?.getBoundingClientRect() ?? el.parentElement.parentElement.getBoundingClientRect()
    return Math.abs((r.left + r.width / 2) - (p.left + p.width / 2))
  })
  assert.ok(center < 2, `model must be centered, offset ${center}`)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.locator('textarea').fill('Test')
  const sendColor = await page.getByRole('button', { name: 'Send', exact: true }).evaluate(el => ({ color: getComputedStyle(el).color, background: getComputedStyle(el).backgroundColor }))
  assert.deepEqual(sendColor, { color: 'rgb(0, 0, 0)', background: 'rgb(209, 213, 219)' })
  console.log('PASS: camera with Agent off; model and reasoning changes with Agent on; centered mobile model; no overflow')
} finally { await browser.close() }
