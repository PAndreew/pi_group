import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import test from 'node:test'

const source = readFileSync(new URL('../src/components/mention-composer.tsx', import.meta.url), 'utf8')
// Exercise the actual parser without loading React or browser API dependencies.
const parser = source.slice(source.indexOf('const NBSP'), source.indexOf('type Suggestion'))
  .replace(/let directory:[\s\S]*?(?=\/\*\*)/, '')
const js = ts.transpile(parser.replaceAll('export ', ''))
const context = vm.createContext({})
vm.runInContext(js, context)

test('only recognized people and agent mentions are removed from message text', () => {
  const raw = '@pi @alex hello $50 /old /skill:review @unknown'
  const parsed = context.parseMessage(raw, [{ id: 'alex', username: 'alex' }])
  assert.equal(parsed.raw, raw)
  assert.equal(parsed.text, 'hello $50 /old /skill:review @unknown')
  assert.equal(parsed.pi, true)
  assert.equal(parsed.people[0].id, 'alex')
})

test('suggestion surface uses opaque composer background and foreground', () => {
  assert.match(source, /bg-\[var\(--composer-background\)\] text-\[var\(--composer-foreground\)\]/)
  assert.match(source, /token.query.startsWith\("skill:"\)/)
})
