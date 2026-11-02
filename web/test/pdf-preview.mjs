import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage()
  page.on('pageerror', error => console.error(error.message))
  page.on('console', message => { if (message.type() === 'error') console.error(message.text()) })
  // Older Safari releases lack this API. Exercise the real viewer and worker.
  await page.addInitScript(() => { delete Promise.withResolvers })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { default: PdfViewer } = await import('/src/components/pdf-viewer.tsx')
    const pdf = '%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF'
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    DOM.createRoot(root).render(React.createElement(PdfViewer, { url: `data:application/pdf;base64,${btoa(pdf)}` }))
  })
  await page.locator('.react-pdf__Page canvas').waitFor({ timeout: 10000 })
  assert.ok(await page.locator('.react-pdf__Page canvas').evaluate(el => el.width > 0 && el.height > 0))
  assert.match(await page.locator('body').innerText(), /1 \/ 1/)
  console.log('PASS: PDF preview renders without native Promise.withResolvers')
} finally {
  await browser.close()
}
