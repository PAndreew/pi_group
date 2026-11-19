import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { SecretStore } from '../vault/src/store.mjs';
import { createGateway } from './server.mjs';

test('pins accounts and models, streams, rejects expired/revoked tokens, and limits calls', async () => {
  const store = new SecretStore(':memory:', randomBytes(32));
  const admin = randomBytes(32).toString('hex');
  const calls = [];
  let time = Date.now();
  const server = createGateway({ store, adminToken: admin, now: () => time, fetchUpstream: async (url, init) => {
    calls.push({ url, key: init.headers.authorization, ...JSON.parse(init.body) });
    return new Response('data: [DONE]\n\n');
  }}).listen(0, '127.0.0.1');
  await once(server, 'listening');
  const call = (path, token, method = 'GET', data) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data),
  });
  const mint = async (account, requests = 1) => {
    const result = await call('/admin/runs', admin, 'POST', { account, model: 'gpt-test', requests, ttlSeconds: 60 });
    assert.equal(result.status, 201);
    return result.json();
  };
  const ask = (token, data = {}) => call('/v1/chat/completions', token, 'POST', { model: 'gpt-test', messages: [{ role: 'user', content: 'Hello' }], stream: true, ...data });
  try {
    for (const account of ['alice', 'sam']) {
      assert.deepEqual(await (await call(`/admin/credentials/${account}`, admin, 'PUT', { apiKey: `fake-${account}` })).json(), { configured: true });
      assert.deepEqual(await (await call(`/admin/credentials/${account}`, admin)).json(), { configured: true });
    }
    const alice = await mint('alice'), sam = await mint('sam');
    assert.equal((await call('/admin/credentials/sam', alice.token)).status, 401);
    assert.equal((await ask(alice.token, { model: 'other' })).status, 400);
    assert.equal((await ask(alice.token, { max_completion_tokens: 4097 })).status, 400);
    assert.equal(calls.length, 0);
    const result = await ask(alice.token);
    assert.equal(result.headers.get('content-type'), 'text/event-stream');
    assert.equal(await result.text(), 'data: [DONE]\n\n');
    assert.equal((await ask(alice.token)).status, 429);
    await (await ask(sam.token)).text();
    assert.deepEqual(calls.map(call => call.key), ['Bearer fake-alice', 'Bearer fake-sam']);
    assert.ok(calls.every(call => call.url === 'https://api.openai.com/v1/chat/completions' && call.max_completion_tokens === 4096));
    const revoked = await mint('alice');
    await call(`/admin/runs/${revoked.runId}`, admin, 'DELETE');
    assert.equal((await ask(revoked.token)).status, 401);
    const expired = await mint('sam');
    time += 60000;
    assert.equal((await ask(expired.token)).status, 401);
    assert.equal(calls.length, 2);
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
