import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  page.setDefaultTimeout(6000)
  const sent = []
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64')
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/\/tenants\/[^/]+/, '')
    let body = { moves: [], requests: [], chats: [], interactions: [], watches: [], models: [], harnesses: [], projects: [{ id: 'general', name: 'General', general: true, folder: '', links: [] }], tenants: [], jobs: [], applets: [], sessions: [], users: [], folders: [], chatFolder: 'pi-chat' }
    if (path === '/api/auth/me') body = { user: { id: 'u', username: 'Tester', role: 'user' } }
    else if (path === '/api/sessions/s') body = { session: { key: 's', harness: 'pi', path: '', access: 'owner', live: false } }
    else if (path === '/api/fs/upload') body = { files: [{ path: 'pi-chat/uploads/sample.png' }, { path: 'pi-chat/uploads/report.xlsx' }] }
    else if (path === '/api/fs/raw') return route.fulfill({ contentType: 'image/png', body: png })
    else if (path === '/api/chats/test') body = { chat: { id: 'test', folder: '', members: [], pi: false }, messages: [] }
    else if (['/api/chats', '/api/chats/test/messages'].includes(path) && request.method() === 'POST') {
      const { text } = request.postDataJSON()
      sent.push(text)
      body = { message: { id: 1, createdAt: new Date().toISOString(), status: 'done', message: { role: 'user', content: text } } }
    } else if (path.endsWith('/messages')) body = { messages: [] }
    await route.fulfill({ json: body })
  })
  const base = process.env.TEST_URL || 'http://127.0.0.1:5173'
  const composer = page.locator('[data-chat-composer]')
  const fileInput = composer.locator('input[type="file"][multiple]')
  const editor = composer.locator('textarea')
  const send = composer.getByRole('button', { name: 'Send', exact: true })
  const image = { name: 'sample.png', mimeType: 'image/png', buffer: png }
  const sheet = { name: 'report.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from('test') }
  const thumb = composer.getByRole('img', { name: image.name, exact: true })
  const removeImage = composer.getByRole('button', { name: `Remove ${image.name}`, exact: true })
  const removeSheet = composer.getByRole('button', { name: `Remove ${sheet.name}`, exact: true })

  await page.goto(`${base}/#s=s`)
  await fileInput.setInputFiles(image)
  await thumb.waitFor()
  assert.equal(await editor.inputValue(), '')
  assert.ok(await send.isEnabled())
  await removeImage.click()
  assert.equal(await thumb.count(), 0)

  for (const hash of ['', '#c=test']) {
    await page.goto(`${base}/${hash}`)
    await composer.getByRole('button', { name: 'Attach files', exact: true }).waitFor()
    await fileInput.setInputFiles([image, sheet])
    await thumb.waitFor()
    await removeSheet.waitFor()
    await composer.locator('.file-icon').last().waitFor()
    assert.equal(await editor.inputValue(), '', 'upload never writes a path into the editor')
    assert.equal(await composer.locator('.prose-pi').count(), 0, 'upload does not create a Markdown preview')
    await removeImage.click()
    assert.equal(await thumb.count(), 0)
    const sentCount = sent.length
    await send.click()
    await removeSheet.waitFor({ state: 'detached' })
    assert.deepEqual(sent.slice(sentCount), ['`pi-chat/uploads/report.xlsx`'])
  }
  console.log('PASS: uploads stay out of the editor; image and file tiles can be removed; only the remaining attachment is sent')
} finally { await browser.close() }
