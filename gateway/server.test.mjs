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
    calls.push({ url, key: init.headers.authorization, headers: init.headers, ...JSON.parse(init.body) });
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
    for (const [provider, url] of [
      ['anthropic', 'https://api.anthropic.com/v1/messages'],
      ['gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'],
      ['openrouter', 'https://openrouter.ai/api/v1/chat/completions'],
      ['zhipu', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
    ]) {
      const model = provider === 'openrouter' ? 'vendor/example' : 'test-model';
      const credential = `/admin/credentials/alice/${provider}`;
      assert.equal((await call('/admin/runs', admin, 'POST', { provider, account: 'alice', model })).status, 409);
      assert.equal((await call(credential, admin, 'PUT', { apiKey: `fake-${provider}` })).status, 200);
      const issued = await call('/admin/runs', admin, 'POST', { provider, account: 'alice', model, requests: 2 });
      assert.equal(issued.status, 201);
      const { token } = await issued.json();
      const native = provider === 'anthropic';
      const input = { model, messages: [{ role: 'user', content: 'Hello' }], stream: true, max_tokens: 42 };
      assert.equal((await call(native ? '/v1/chat/completions' : '/v1/messages', token, 'POST', input)).status, 400);
      const route = native ? '/v1/messages' : '/v1/chat/completions';
      const result = await call(route, token, 'POST', input);
      assert.equal(result.status, 200);
      await result.text();
      assert.equal(calls.at(-1).url, url);
      assert.equal(calls.at(-1).model, model);
      assert.equal(calls.at(-1).max_tokens, 42);
      assert.equal(calls.at(-1).key, native ? undefined : `Bearer fake-${provider}`);
      if (native) {
        assert.equal(calls.at(-1).headers['x-api-key'], 'fake-anthropic');
        assert.equal(calls.at(-1).headers['anthropic-version'], '2023-06-01');
      }
      await call(credential, admin, 'DELETE');
      assert.equal((await call(route, token, 'POST', input)).status, 401);
    }
  } finally { await new Promise(resolve => server.close(resolve)); store.close(); }
});
