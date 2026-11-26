import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the Vite dev server. The shared browser's socket is mocked; the real panel types and copies.
const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE })
try {
  const context = await browser.newContext({ viewport: { width: 400, height: 844 }, hasTouch: true, isMobile: true })
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: process.env.TEST_URL || 'http://127.0.0.1:5173' })
  const page = await context.newPage()
  page.setDefaultTimeout(5000)
  page.on('pageerror', (error) => console.error(error))
  await page.route('**/__browser_keyboard_test', (route) => route.fulfill({ contentType: 'text/html', body: `
    <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
    <div id="root" style="height: 100dvh"></div>
    <script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/test/fixtures/browser-picker.tsx');
    </script>` }))
  const sent = []
  let server
  await page.routeWebSocket('**/api/browser?*', (socket) => {
    server = socket
    socket.send(JSON.stringify({ type: 'state', url: 'https://example.test', title: 'Example', viewport: { width: 390, height: 700 }, canInput: true, canResize: false }))
    socket.send(JSON.stringify({ type: 'editables', boxes: [{ x: 20, y: 20, width: 200, height: 30 }] }))
    socket.onMessage((raw) => {
      const message = JSON.parse(raw)
      if (message.type === 'presentation' || message.type === 'viewport') return
      sent.push(message)
      if (message.type === 'copy') socket.send(JSON.stringify({ type: 'copied', id: message.id, text: 'copied text' }))
    })
  })
  await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/__browser_keyboard_test`)
  const canvas = page.locator('canvas')
  await canvas.waitFor()
  const scale = (await canvas.boundingBox()).width / 390
  const ime = page.getByRole('textbox', { name: 'Type into the page' })
  const focused = () => ime.evaluate((el) => el === document.activeElement)

  // A tap outside any field does not open the keyboard; one on a field does.
  await canvas.tap({ position: { x: 300 * scale, y: 400 * scale } })
  assert.equal(await focused(), false)
  await canvas.tap({ position: { x: 50 * scale, y: 30 * scale } })
  assert.equal(await focused(), true, 'a tap on a text field opens the keyboard')
  sent.length = 0
  await page.keyboard.type('hé😀')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Control+a')
  await page.waitForTimeout(100)
  assert.deepEqual(sent.map((m) => m.type === 'text' ? m.text : m.key), ['h', 'é', '😀', 'Backspace', 'Backspace', 'Backspace', 'Enter', 'Control+a'])

  // Taps keep the keyboard open until the page says no text field has focus.
  await canvas.tap({ position: { x: 60 * scale, y: 30 * scale } })
  assert.equal(await focused(), true)
  server.send(JSON.stringify({ type: 'focus', editable: false }))
  await page.waitForFunction(() => document.activeElement?.localName !== 'textarea')

  // The keyboard button opens it anywhere.
  await page.getByRole('button', { name: 'Type into the page' }).tap()
  assert.equal(await focused(), true)

  // Copy from the page lands on this device's clipboard; Paste sends it back.
  await page.getByRole('button', { name: 'Copy from the page' }).tap()
  await page.waitForFunction(async () => (await navigator.clipboard.readText()) === 'copied text')
  await page.evaluate(() => navigator.clipboard.writeText('from my phone'))
  sent.length = 0
  await page.getByRole('button', { name: 'Paste into the page' }).tap()
  await page.waitForTimeout(200)
  assert.deepEqual(sent, [{ type: 'text', text: 'from my phone' }])

  // Text the page copies on its own (a copy button) is offered too.
  server.send(JSON.stringify({ type: 'clipboard', text: 'page button text' }))
  await page.waitForFunction(async () => (await navigator.clipboard.readText()) === 'page button text')
  console.log('PASS: native keyboard typing, focus hints and the clipboard bridge')
} finally { await browser.close() }
