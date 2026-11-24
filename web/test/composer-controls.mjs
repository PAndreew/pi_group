import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  page.setDefaultTimeout(5000)
  const user = { id: 'u', username: 'Tester', role: 'user' }
  const users = [user, { id: 'a', username: 'Alice' }, { id: 's', username: 'Sam' }]
  const models = [{ provider: 'test', id: 'one', name: 'First model' }, { provider: 'test', id: 'two', name: 'Second model' }]
  const base = process.env.TEST_URL || 'http://127.0.0.1:15173'
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const body = {
      '/api/auth/me': { user },
      '/api/tenants': { active: 'work', tenants: [{ id: 'work', name: 'Work' }] },
      '/api/projects': { projects: [] },
      '/api/projects/moves': { moves: [] },
      '/api/folders/search': { folders: [], chatFolder: 'pi-chat' },
      '/api/harnesses': { harnesses: [{ id: 'pi', ok: true }] },
      '/api/harnesses/pi/models': { models },
      '/api/chats': { chats: [] },
      '/api/users/directory': { users },
    }[path] ?? { sessions: [], jobs: [], applets: [], watches: [], tools: [], commands: [], resources: [] }
    await route.fulfill({ json: body })
  })
  await page.goto(base)
  const editor = page.locator('[data-chat-composer] textarea')
  const mention = page.getByRole('button', { name: 'Mention participants' })
  const model = page.getByRole('button', { name: 'Current session model' })
  const send = page.getByRole('button', { name: 'Send', exact: true })
  const submit = async () => {
    const request = page.waitForRequest(r => r.method() === 'POST' && new URL(r.url()).pathname === '/api/chats')
    await send.click()
    const sent = await request
    await (await sent.response()).finished()
    await page.waitForFunction(() => document.querySelector('[data-chat-composer] textarea')?.value === '')
    return sent.postDataJSON()
  }
  const pick = async (name) => {
    await mention.tap()
    assert.equal(await editor.evaluate(el => el === document.activeElement), true)
    assert.equal(await editor.evaluate(el => el.value[el.selectionStart - 1]), '@')
    await page.getByRole('option', { name }).tap()
  }

  const camera = page.getByRole('button', { name: 'Take photo' })
  const chooser = page.waitForEvent('filechooser')
  await camera.click()
  await chooser
  await model.filter({ hasText: 'First model' }).click()
  await page.getByRole('menuitem', { name: 'Second model' }).click()
  assert.equal(await model.textContent(), 'Second model')
  const center = await model.evaluate(el => {
    const r = el.getBoundingClientRect(), p = el.closest('[data-chat-composer]').getBoundingClientRect()
    return Math.abs(r.left + r.width / 2 - (p.left + p.width / 2))
  })
  assert.ok(center < 2, `model must be centered, offset ${center}`)
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)

  await editor.fill('Ask the agent')
  assert.deepEqual(await submit(), { text: 'Ask the agent', pi: true, userIds: [], model: { provider: 'test', id: 'two' }, thinkingLevel: 'off' })

  await editor.fill('Ask both people')
  await editor.press('Home')
  await pick(/Alice/)
  await pick(/Sam/)
  assert.equal(await editor.inputValue(), '@Alice @Sam Ask both people')
  assert.deepEqual(await submit(), { text: 'Ask both people', pi: false, userIds: ['a', 's'] })

  await mention.tap()
  await editor.press('A')
  await page.getByRole('option', { name: /Alice/ }).waitFor()
  await editor.press('Tab')
  await pick(/Beezy/)
  await editor.pressSequentially('Work together')
  assert.deepEqual(await submit(), { text: 'Work together', pi: true, userIds: ['a'], model: { provider: 'test', id: 'two' }, thinkingLevel: 'off' })
  console.log('PASS: home defaults to Beezy; @ inserts at the caret; touch and keyboard can pick multiple people and Beezy; camera and model controls work')
} finally { await browser.close() }
