import assert from 'node:assert/strict'
import { webkit, devices } from 'playwright'

const browser = await webkit.launch()
try {
  const { defaultBrowserType, ...mobile } = devices['iPhone 13']
  const page = await browser.newPage(mobile)
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:5173')
  await page.evaluate(async () => {
    const { default: React } = await import('/node_modules/.vite/deps/react.js')
    const { default: DOM } = await import('/node_modules/.vite/deps/react-dom_client.js')
    const { PreviewErrorBoundary } = await import('/src/components/preview-error-boundary.tsx')
    const root = document.createElement('div')
    document.body.replaceChildren(root)
    const BrokenPreview = React.lazy(() => Promise.reject(new Error('PDF module failed to load')))
    DOM.createRoot(root).render(React.createElement('main', null,
      React.createElement('nav', null, 'App navigation'),
      React.createElement(PreviewErrorBoundary, { downloadUrl: '/download.pdf' },
        React.createElement(React.Suspense, { fallback: 'Loading' }, React.createElement(BrokenPreview))),
    ))
  })
  await page.getByRole('alert').waitFor()
  assert.match(await page.getByRole('alert').innerText(), /PDF module failed to load/)
  assert.equal(await page.getByRole('navigation').innerText(), 'App navigation')
  assert.equal(await page.getByRole('link', { name: 'Download PDF' }).getAttribute('href'), '/download.pdf')
  console.log('PASS: failed lazy PDF preview preserves app and displays diagnostic/download')
} finally {
  await browser.close()
}
