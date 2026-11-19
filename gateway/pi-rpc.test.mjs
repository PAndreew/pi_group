import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SecretStore } from '../vault/src/store.mjs';
import { createGateway } from './server.mjs';

const pi = process.env.BEEZY_TEST_PI;
test('Pi RPC streams through the gateway with only a run token', { skip: !pi, timeout: 20000 }, async () => {
  const store = new SecretStore(':memory:', randomBytes(32));
  store.put('alice', 'openrouter', { value: 'mock-provider-key' });
  const adminToken = randomBytes(32).toString('hex');
  const model = 'vendor/test';
  let seen;
  const server = createGateway({ store, adminToken, fetchUpstream: async (_, request) => {
    seen = request.headers.authorization;
    const chunk = { id: 'test', object: 'chat.completion.chunk', created: 1, model, choices: [{ index: 0, delta: { role: 'assistant', content: 'Hello from gateway' }, finish_reason: 'stop' }] };
    return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
  }}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const extension = fileURLToPath(new URL('../server/extensions/model-gateway.mjs', import.meta.url));
  const child = spawn(pi, ['--mode', 'rpc', '--no-session', '--no-extensions', '--extension', extension], { env: { ...process.env, BEEZY_GATEWAY_URL: base }, stdio: ['pipe', 'pipe', 'ignore'] });
  const records = createInterface({ input: child.stdout });
  const events = [];
  const pending = new Map();
  records.on('line', line => {
    const record = JSON.parse(line);
    events.push(record);
    if (record.type === 'response') pending.get(record.id)?.(record);
  });
  function rpc(command) {
    const id = randomBytes(10).toString('hex');
    const response = new Promise(resolve => pending.set(id, resolve));
    child.stdin.write(JSON.stringify({ ...command, id }) + '\n');
    return response.then(record => { pending.delete(id); assert.equal(record.success, true, record.error); return record.data; });
  }
  try {
    const response = await fetch(`${base}/admin/runs`, { method: 'POST', headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ account: 'alice', provider: 'openrouter', model }) });
    assert.equal(response.status, 201);
    const { token } = await response.json();
    const config = Buffer.from(JSON.stringify({ provider: 'openrouter', model, token })).toString('base64url');
    await rpc({ type: 'prompt', message: `/beezy-gateway-run ${config}` });
    await rpc({ type: 'set_model', provider: 'beezy-personal', modelId: model });
    await rpc({ type: 'prompt', message: 'Say hello' });
    const deadline = Date.now() + 10000;
    while (!events.some(e => e.type === 'agent_settled') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(seen, 'Bearer mock-provider-key');
    const { messages } = await rpc({ type: 'get_messages' });
    assert.ok(JSON.stringify(messages).includes('Hello from gateway'));
    assert.ok(!JSON.stringify(messages).includes(token));
    await rpc({ type: 'prompt', message: '/beezy-gateway-clear' });
  } finally {
    child.kill(); records.close();
    await new Promise(resolve => server.close(resolve)); store.close();
  }
});
