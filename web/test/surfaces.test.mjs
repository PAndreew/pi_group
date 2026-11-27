import assert from 'node:assert/strict'
import test from 'node:test'
import { canOpen, matches, parseActions, surface, SURFACES } from '../src/lib/surfaces.ts'
import { SURFACES as AGENT_SURFACES } from '../../server/extensions/lib/app-guide.mjs'

test('the web and the agent guide know the same surfaces, with the same admin ones', () => {
  assert.deepEqual(SURFACES.map((s) => s.id).sort(), AGENT_SURFACES.map((s) => s.id).sort())
  for (const s of AGENT_SURFACES) assert.equal(Boolean(surface(s.id).admin), Boolean(s.admin), s.id)
})

test('action blocks: one object or a few, unknown ids and odd params dropped', () => {
  assert.deepEqual(parseActions('{"open":"vault","label":" Add key ","params":{"key":"OPENAI_API_KEY","x":{"a":1}}}'), [{ open: 'vault', label: 'Add key', params: { key: 'OPENAI_API_KEY' } }])
  assert.deepEqual(parseActions('[{"open":"nope"},{"open":"applets"},{"open":"links"},{"open":"files"},{"open":"tools"}]').map((a) => a.open), ['applets', 'links', 'files'])
  assert.deepEqual(parseActions('not json'), [])
  assert.deepEqual(parseActions('{"open":"new-session","params":{"browser":true}}')[0].params, { browser: true })
})

test('admin surfaces are hidden from others', () => {
  assert.equal(canOpen(surface('terminal'), 'user'), false)
  assert.equal(canOpen(surface('terminal'), 'admin'), true)
  assert.equal(canOpen(surface('vault'), 'user'), true)
  assert.equal(canOpen(undefined, 'admin'), false)
})

test('palette matching needs every word', () => {
  assert.ok(matches('rem mach', 'Remote machines ssh'))
  assert.ok(!matches('rem gpu x', 'Remote machines ssh gpu'))
})
