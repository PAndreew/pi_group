import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

test('push chat and session links retain their originating tenant', async () => {
  const handlers = {}
  const shown = []
  vm.runInNewContext(readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URLSearchParams, encodeURIComponent,
    self: {
      addEventListener: (name, fn) => { handlers[name] = fn },
      clients: { matchAll: async () => [] },
      registration: { showNotification: async (title, options) => shown.push(options) },
    },
  })
  for (const notice of [
    { type: 'chat', tenantId: 'family', chatId: 'chat-1', author: 'Alice', title: 'Chat' },
    { type: 'run', tenantId: 'work', key: 'session-1', path: 'folder', kind: 'finished' },
  ]) {
    let done
    handlers.push({ data: { json: () => notice }, waitUntil: p => { done = p } })
    await done
  }
  assert.equal(shown[0].data.url, '/?tenant=family#c=chat-1')
  assert.equal(shown[1].data.url, '/?tenant=work#f=folder&s=session-1')
})
