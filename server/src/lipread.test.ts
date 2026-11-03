import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';

test('lip-reading correction requires login, is opt-in and sends text only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beezy-lipread-'));
  process.env.DATA_DIR = dir;
  delete process.env.LIPREAD_LLM_API_KEY;
  delete process.env.LIPREAD_LLM_MODEL;
  const { authenticate, authRoutes, createUser } = await import('./auth.js');
  const { loadStore, saveNow } = await import('./store.js');
  const { lipreadRoutes } = await import('./lipread.js');
  loadStore(); createUser('lip-test', 'test-password', 'member');
  let sent: Record<string, unknown> | undefined;
  const provider = express(); provider.use(express.json());
  provider.post('/correct', (req, res) => { sent = req.body; res.json({ choices: [{ message: { content: 'Hello there.' } }] }); });
  const upstream = provider.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const app = express(); app.use(express.json(), authenticate, authRoutes(), lipreadRoutes());
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/lipread/config')).status, 401);
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lip-test', password: 'test-password' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-Pi-Group': '1' };
    assert.deepEqual(await (await fetch(base + '/lipread/config', { headers })).json(), { correction: false });
    assert.equal((await fetch(base + '/lipread/correct', { method: 'POST', headers, body: JSON.stringify({ text: 'HELLO THERE' }) })).status, 503);
    process.env.LIPREAD_LLM_API_KEY = 'test-only'; process.env.LIPREAD_LLM_MODEL = 'test-model';
    const remote = upstream.address(); assert.ok(remote && typeof remote !== 'string');
    process.env.LIPREAD_LLM_URL = `http://127.0.0.1:${remote.port}/correct`;
    const corrected = await fetch(base + '/lipread/correct', { method: 'POST', headers, body: JSON.stringify({ text: 'HELLO THERE' }) });
    assert.equal(corrected.status, 200); assert.deepEqual(await corrected.json(), { text: 'Hello there.' });
    assert.equal(sent?.model, 'test-model');
    assert.deepEqual((sent?.messages as { role: string; content: string }[])[1], { role: 'user', content: 'HELLO THERE' });
    assert.ok(!JSON.stringify(sent).includes('video'));
  } finally {
    await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => upstream.close(() => r()))]);
    saveNow(); rmSync(dir, { recursive: true, force: true });
    delete process.env.LIPREAD_LLM_API_KEY; delete process.env.LIPREAD_LLM_MODEL; delete process.env.LIPREAD_LLM_URL;
  }
});
