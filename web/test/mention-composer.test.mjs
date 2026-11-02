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

test('slash folders round-trip with spaces; skill commands remain message text', () => {
  const raw = context.withFolder('@pi hello /old /skill:review', 'my project/src')
  assert.equal(raw, '/my\u00a0project/src @pi hello  /skill:review')
  const parsed = context.parseMessage(raw, [])
  assert.equal(parsed.folder, 'my project/src')
  assert.equal(parsed.text, 'hello /skill:review')
  assert.equal(parsed.pi, true)
  assert.equal(context.parseMessage('$money hello', []).folder, undefined)
})

test('suggestion surface uses opaque composer background and foreground', () => {
  assert.match(source, /bg-\[var\(--composer-background\)\] text-\[var\(--composer-foreground\)\]/)
  assert.match(source, /token.query.startsWith\("skill:"\)/)
})
