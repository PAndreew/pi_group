import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const documentUrl = process.env.PDF_FILE ? `data:application/pdf;base64,${readFileSync(process.env.PDF_FILE).toString('base64')}` : null
import { chromium, webkit, devices } from 'playwright'

for (const engine of [chromium, webkit]) {
  const browser = await engine.launch({ headless: true })
  try {
    const { defaultBrowserType: _, ...mobile } = devices['iPhone 13']
    const page = await browser.newPage(mobile)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.addInitScript(() => { delete Promise.withResolvers })
    await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
    await page.evaluate(async (documentUrl) => {
      const { default: React } = await import('/node_modules/.vite/deps/react.js')
      const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
      const { default: PdfViewer } = await import('/src/components/pdf-viewer.tsx')
      const stream = '1 0 0 rg 0 0 200 200 re f'
      const pdf = `%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]/Contents 4 0 R>>endobj\n4 0 obj<</Length ${stream.length}>>stream\n${stream}\nendstream\nendobj\ntrailer<</Root 1 0 R>>\n%%EOF`
      const root = document.createElement('div')
      root.style.cssText = 'height:100dvh;width:100%;min-width:0'
      document.body.replaceChildren(root)
      DOM.createRoot(root).render(React.createElement(PdfViewer, { url: documentUrl || `data:application/pdf;base64,${btoa(pdf)}` }))
    }, documentUrl)
    const canvas = page.locator('.react-pdf__Page canvas')
    await canvas.waitFor({ timeout: 10000 })
    // Allow asynchronous painting to finish before checking that it stays painted.
    await page.waitForFunction((realDocument) => {
      const el = document.querySelector('.react-pdf__Page canvas')
      if (!el) return false
      const pixel = el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data
      return el.style.visibility !== 'hidden' && (realDocument || (pixel[0] === 255 && pixel[1] === 0 && pixel[2] === 0 && pixel[3] === 255))
    }, Boolean(documentUrl))
    // Check actual pixels, not just canvas existence, after layout has settled.
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000)
      const pixel = await canvas.evaluate(el => Array.from(el.getContext('2d').getImageData(el.width / 2, el.height / 2, 1, 1).data))
      if (!documentUrl) assert.deepEqual(pixel, [255, 0, 0, 255], `${engine.name()}: preview must stay painted`)
      else assert.ok(await canvas.evaluate(el => {
        const data = el.getContext('2d').getImageData(0, 0, el.width, el.height).data
        let painted = 0
        for (let i = 0; i < data.length; i += 4) if (data[i] < 240 || data[i + 1] < 240 || data[i + 2] < 240) painted++
        return painted > el.width * el.height * 0.01
      }), `${engine.name()}: document must not turn white`)
      assert.ok(await canvas.evaluate(el => el.width * el.height <= 4_000_000), 'Canvas backing store must stay bounded')
    }
    assert.ok(await canvas.evaluate(el => el.width <= el.getBoundingClientRect().width * 2), 'Retina density must be capped')
    for (let i = 0; i < 8; i++) await page.getByRole('button').nth(3).click()
    await page.waitForFunction(() => {
      const el = document.querySelector('canvas')
      return el && el.style.visibility !== 'hidden' && el.width * el.height <= 4_000_000
    })
    assert.match(await page.locator('body').innerText(), /1 \/ 1/)
    assert.deepEqual(errors, [])
    console.log(`PASS: ${engine.name()} mobile PDF stays painted without native Promise.withResolvers`)
  } finally {
    await browser.close()
  }
}
