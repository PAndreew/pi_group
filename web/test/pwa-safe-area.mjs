import assert from 'node:assert/strict'
import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await page.goto(process.env.TEST_URL || 'http://127.0.0.1:8788/')
  // Reserve the same 34px bottom inset as an iPhone standalone PWA.
  await page.evaluate(() => document.documentElement.style.setProperty('--app-safe-bottom', '34px'))
  const gap = await page.locator('#root').evaluate(el => innerHeight - el.getBoundingClientRect().bottom)
  assert.ok(gap >= 40, `app content must clear the 34px safe area plus 6px; got ${gap}px`)
  console.log('PASS: app reserves iPhone bottom safe area plus 6px')
} finally { await browser.close() }
