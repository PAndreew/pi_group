import assert from 'node:assert/strict'
import { chromium } from 'playwright'

// Run against the Vite dev server. Mock only the shared browser's socket; drive the real panel.
const browser = await chromium.launch()
try {
  for (const mobile of [true, false]) {
    const page = await browser.newPage({ viewport: { width: mobile ? 390 : 1280, height: 844 }, hasTouch: mobile, isMobile: mobile })
    page.setDefaultTimeout(8000)
    page.on('pageerror', (error) => console.error(error))
    await page.route('**/__browser_picker_test', (route) => route.fulfill({ contentType: 'text/html', body: `
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
    await page.routeWebSocket('**/api/browser?*', (socket) => {
      socket.send(JSON.stringify({ type: 'state', url: 'https://example.test', title: 'Example', viewport: { width: 390, height: 620 }, canInput: false }))
      socket.onMessage((raw) => {
        const request = JSON.parse(raw)
        if (request.type !== 'pick') return
        socket.send(JSON.stringify({ type: 'picked', id: request.id, url: 'https://example.test', title: 'Example', elements: [{ selector: 'button', text: 'Example item' }], image: 'fixture-png' }))
      })
    })
    await page.goto(`${process.env.TEST_URL || 'http://127.0.0.1:5173'}/__browser_picker_test`)
    const pick = async () => {
      await page.getByRole('button', { name: 'Pick elements to reference' }).click()
      const canvas = page.locator('canvas')
      if (mobile) await canvas.tap({ position: { x: 30, y: 30 } })
      else await canvas.click({ position: { x: 30, y: 30 } })
    }
    const assertFloatingPick = async () => {
      const chip = page.getByRole('button', { name: 'Remove pick', exact: true })
      await chip.waitFor({ timeout: 3000 })
      if (mobile) assert.equal(await page.getByRole('textbox', { name: 'Ask about this page' }).evaluate((el) => el === document.activeElement), false, 'a pick must not summon the mobile keyboard')
      await page.getByRole('button', { name: 'Send', exact: true }).click()
      await page.waitForFunction(() => window.sent)
      assert.equal(await page.evaluate(() => window.sent.picks[0].image), 'fixture-png')
    }
    await pick()
    if (mobile) {
      await assertFloatingPick()
      assert.equal(await page.evaluate(() => window.sessionPick), undefined)
    } else {
      await page.waitForFunction(() => window.sessionPick)
      await page.getByRole('button', { name: 'Ask about this page', exact: true }).click()
      await pick()
      await assertFloatingPick()
    }
    await page.close()
  }
  console.log('PASS: mobile picks go to the floating ask box; desktop preserves both pick destinations')
} finally { await browser.close() }
