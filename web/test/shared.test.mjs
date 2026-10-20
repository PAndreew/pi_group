import assert from 'node:assert/strict'
import test from 'node:test'
import { linkify, parseShared } from '../src/lib/shared.ts'

test('shared messages split into a linked label and a body', () => {
  assert.deepEqual(parseShared('Shared from [session “Plan”](#f=a&s=pi%3A1):\n\nSee **this**\n\nnext'), { label: 'session “Plan”', href: '#f=a&s=pi%3A1', body: 'See **this**\n\nnext' })
})
test('older shared messages without a link still parse', () => {
  assert.deepEqual(parseShared('Shared from session “Plan”:\n\nBody'), { label: 'session “Plan”', href: undefined, body: 'Body' })
})
test('ordinary messages are not shared ones', () => assert.equal(parseShared('Shared from memory, I think'), undefined))

test('urls become links without trailing punctuation', () => {
  assert.deepEqual(linkify('See https://example.com/a?b=1. Or www.x.org!'), [
    { text: 'See ' },
    { url: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' },
    { text: '. Or ' },
    { url: 'www.x.org', href: 'https://www.x.org' },
    { text: '!' },
  ])
})
test('parentheses stay in a link only when balanced', () => {
  assert.deepEqual(linkify('(https://en.wikipedia.org/wiki/Foo_(bar))'), [
    { text: '(' },
    { url: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' },
    { text: ')' },
  ])
})
test('other schemes are left as text', () => assert.deepEqual(linkify('javascript:alert(1) ftp://x'), [{ text: 'javascript:alert(1) ftp://x' }]))
