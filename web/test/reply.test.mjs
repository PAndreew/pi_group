import assert from 'node:assert/strict'
import test from 'node:test'
import { replyPrompt } from '../src/lib/reply.ts'

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
