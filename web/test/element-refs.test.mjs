import assert from 'node:assert/strict'
import test from 'node:test'
import { refsPrompt, splitBrowserRefs } from '../src/lib/element-refs.ts'

const page = { url: 'https://news.ycombinator.com/', title: 'Hacker News (front page)' }
const element = {
  selector: '#\\35 0611576 > td.title:nth-of-type(3) > span.titleline > a',
  text: 'Nvidia Reinstates Jensen Huang as CEO',
  html: '<a title="a ` backtick">Example</a>',
  box: { x: -38, y: 111, width: 268, height: 16 },
  component: 'Link', source: 'src/item.tsx:42',
}

test('reads stored picks, groups by page, and preserves the question and attachments', () => {
  const picks = refsPrompt([
    { ...page, elements: [element] },
    { url: 'https://example.test/another', elements: [{ ...element, text: '', component: undefined, source: undefined }] },
    { ...page, elements: [{ ...element, text: 'The "quote" contains `code`' }] },
  ], ['picked-123-1.png', undefined, 'picked-123-3 (1).png'])
  const attachments = 'Attached files (relative to the working directory):\n- ../uploads/picked-123-1.png\n- ../uploads/report.pdf'
  const result = splitBrowserRefs(`21 — chosen from an open browser\n\n${picks}\n\n${attachments}`)
  assert.equal(result.text, `21 — chosen from an open browser\n\n${attachments}`)
  assert.equal(result.pages.length, 2)
  assert.equal(result.pages[0].title, page.title)
  assert.deepEqual(result.pages[0].picks[0], {
    screenshot: 'picked-123-1.png',
    elements: [{ selector: element.selector, text: element.text, origin: 'component Link, source src/item.tsx:42', bounds: '-38,111 268×16' }],
  })
  assert.equal(result.pages[0].picks[1].screenshot, 'picked-123-3 (1).png')
  assert.equal(result.pages[0].picks[1].elements[0].text, 'The "quote" contains `code`')
  assert.equal(result.pages[1].picks[0].elements[0].text, undefined)
})

test('keeps ordinary or malformed text as written', () => {
  const text = 'Referenced page elements (picked in the shared browser):\nThese are my own notes.'
  assert.deepEqual(splitBrowserRefs(text), { text, pages: [] })
})
