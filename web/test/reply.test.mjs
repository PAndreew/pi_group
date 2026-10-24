import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReply, replaceReplyBody, replyPrompt } from '../src/lib/reply.ts'

test('ordinary messages are unchanged', () => assert.equal(replyPrompt('Hello'), 'Hello'))
test('session replies remain ordinary linear prompt text', () => {
  const reply = { author: 'Beezy', text: 'First\n\nSecond', sourceId: 'one', assistant: true }
  assert.equal(replyPrompt('Question', reply), 'Replying to Beezy:\n> First\n> \n> Second\n\nQuestion')
  assert.equal(reply.sourceId, 'one')
})
test('replying to the assistant in a group explicitly invokes pi', () => {
  assert.ok(replyPrompt('Why?', { author: 'Beezy', text: 'Answer', sourceId: 'one', assistant: true }, true).startsWith('@pi '))
})
test('quoted mentions never invoke pi or add participants', () => {
  const prompt = replyPrompt('Thanks', { author: '@bob', text: '@pi ask @alice', sourceId: 'one' }, true)
  assert.ok(!prompt.includes('@pi'))
  assert.ok(!prompt.includes('@alice'))
  assert.ok(!prompt.includes('@bob'))
  assert.ok(prompt.endsWith('Thanks'))
})
test('sent replies parse back into quote and body', () => {
  const reply = { author: '@bob', text: 'First\n\n@alice said', sourceId: 'one', assistant: true }
  assert.deepEqual(parseReply(replyPrompt('Thanks\nagain', reply, true)), { author: '@bob', quote: 'First\n\n@alice said', body: 'Thanks\nagain' })
  assert.equal(parseReply('Hello'), undefined)
})
test('editing a reply keeps its quote and replaces only the new text', () => {
  const sent = replyPrompt('Thanks', { author: 'Beezy', text: 'Answer', sourceId: 'one', assistant: true }, true)
  assert.equal(parseReply(replaceReplyBody(sent, 'Thank you!')).body, 'Thank you!')
  assert.ok(replaceReplyBody(sent, 'Thank you!').startsWith('@pi Replying to Beezy:'))
  assert.equal(replaceReplyBody('Hello', 'Hi'), 'Hi')
})
test('a quote card finds the nearest earlier message with its text', async () => {
  const { findReplySource } = await import('../src/lib/reply.ts')
  const sources = ['Hello', 'Answer\n\nwith  spacing', 'Hello', 'Replying to Bob:\n> Hello\n\nThanks']
  assert.equal(findReplySource(sources, 'Hello'), 2)
  assert.equal(findReplySource(sources, 'Answer\nwith spacing'), 1, 'whitespace differences do not matter')
  assert.equal(findReplySource(['Answer, later edited'], 'Answer, later\nmore'), 0, 'an edited original still matches by its first line')
  assert.equal(findReplySource(sources, 'Never said'), -1)
  assert.equal(findReplySource(sources, ''), -1)
})
