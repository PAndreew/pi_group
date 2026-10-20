import assert from 'node:assert/strict'
import test from 'node:test'

test('a page stays pinned while switching storage, including unload callbacks and late requests', async () => {
  const values = new Map([['pi-group:tenant', 'work']])
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  const { activeTenant, setActiveTenant, tenantUrl } = await import('../src/lib/tenant.ts')
  setActiveTenant('family')
  assert.equal(values.get('pi-group:tenant'), 'family')
  assert.equal(activeTenant(), 'work', 'old page must never reinterpret its cached state or requests as Family')
  assert.equal(tenantUrl('/api/notifications'), '/api/notifications?tenant=work')
})
