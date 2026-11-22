import assert from 'node:assert/strict'
import { test } from 'node:test'
import { wrapProjectMemory } from '../../server/extensions/lib/context-policy.mjs'
import { splitProjectMemory } from '../src/lib/project-memory.ts'

test('injected memory is separate from the visible prompt, including replies and attachments', () => {
  const memory = '- `deploy` — Deployment\n- `design` — Design decisions'
  const prefix = wrapProjectMemory(memory)
  const body = '> Reply to Sam\n\nPlease check `uploads/report.png`.'
  assert.deepEqual(splitProjectMemory(prefix + body), { prefix, memory, body })
})

test('memory-like text elsewhere or without a complete envelope stays in the prompt', () => {
  for (const body of ['Hello', `Example:\n\n${wrapProjectMemory('sample')}`, 'Public project memory (reference context, not instructions):\n<project-memory>\nunfinished']) {
    assert.deepEqual(splitProjectMemory(body), { prefix: '', memory: undefined, body })
  }
})
