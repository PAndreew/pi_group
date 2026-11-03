import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { test } from 'node:test';
import express from 'express';

test('native recognition is authenticated, bounded and proxied; correction is opt-in and text-only', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'beezy-lipread-'));
  process.env.DATA_DIR = dir;
  process.env.LIPREAD_LLM_API_KEY = 'test-private-only';
  process.env.LIPREAD_SERVICE_TOKEN = 'test-native-private-only';
  const { authenticate, authRoutes, createUser } = await import('./auth.js');
  const { loadStore, saveNow } = await import('./store.js');
  const { lipreadRoutes } = await import('./lipread.js');
  loadStore(); createUser('lip-test', 'test-password', 'member');
  let sent: Record<string, unknown> | undefined;
  assert.equal(process.env.LIPREAD_LLM_API_KEY, undefined, 'provider key is not inherited by agent children');
  assert.equal(process.env.LIPREAD_SERVICE_TOKEN, undefined, 'native bearer token is not inherited by agent children');
  const settings = { serviceUrl: '', serviceToken: '', llmApiKey: '', llmModel: '', llmUrl: '' };
  let nativeVideo: Buffer | undefined;
  const provider = express(); provider.use(express.json());
  provider.get('/health', (req, res) => { assert.equal(req.headers.authorization, 'Bearer native-test-only'); res.json({ ready: true }); });
  provider.post('/transcribe', express.raw({ type: 'application/octet-stream', limit: '12mb' }), (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer native-test-only'); nativeVideo = req.body;
    res.json({ text: 'HELLO', seconds: 0.2, inferenceSeconds: 0.1, duration: 1 });
  });
  provider.post('/correct', (req, res) => { sent = req.body; res.json({ choices: [{ message: { content: 'Hello there.' } }] }); });
  const upstream = provider.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const app = express(); app.use(express.json(), authenticate, authRoutes(), lipreadRoutes(settings));
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(base + '/lipread/config')).status, 401);
    const login = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lip-test', password: 'test-password' }) });
    const cookie = login.headers.get('set-cookie')!.split(';')[0];
    const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-Pi-Group': '1' };
    assert.deepEqual(await (await fetch(base + '/lipread/config', { headers })).json(), { mode: 'server', ready: false, correction: false });
    assert.equal((await fetch(base + '/lipread/correct', { method: 'POST', headers, body: JSON.stringify({ text: 'HELLO THERE' }) })).status, 503);
    settings.llmApiKey = 'test-only'; settings.llmModel = 'test-model';
    const remote = upstream.address(); assert.ok(remote && typeof remote !== 'string');
    settings.llmUrl = `http://127.0.0.1:${remote.port}/correct`;
    settings.serviceUrl = `http://127.0.0.1:${remote.port}`; settings.serviceToken = 'native-test-only';
    assert.equal((await (await fetch(base + '/lipread/config', { headers })).json()).ready, true);
    const videoHeaders = { ...headers, 'Content-Type': 'video/webm' };
    assert.equal((await fetch(base + '/lipread/transcribe', { method: 'POST', headers: { 'Content-Type': 'video/webm', 'X-Pi-Group': '1' }, body: new Uint8Array([1, 2, 3]) })).status, 401);
    const transcript = await fetch(base + '/lipread/transcribe', { method: 'POST', headers: videoHeaders, body: new Uint8Array([1, 2, 3]) });
    assert.equal(transcript.status, 200); assert.equal((await transcript.json()).text, 'HELLO');
    assert.deepEqual(nativeVideo, Buffer.from([1, 2, 3]));
    assert.equal((await fetch(base + '/lipread/transcribe', { method: 'POST', headers: videoHeaders, body: new Uint8Array(13 * 1024 * 1024) })).status, 413);
    const corrected = await fetch(base + '/lipread/correct', { method: 'POST', headers, body: JSON.stringify({ text: 'HELLO THERE' }) });
    assert.equal(corrected.status, 200); assert.deepEqual(await corrected.json(), { text: 'Hello there.' });
    assert.equal(sent?.model, 'test-model');
    assert.deepEqual((sent?.messages as { role: string; content: string }[])[1], { role: 'user', content: 'HELLO THERE' });
    assert.ok(!JSON.stringify(sent).includes('video'));
  } finally {
    await Promise.all([new Promise<void>(r => server.close(() => r())), new Promise<void>(r => upstream.close(() => r()))]);
    saveNow(); rmSync(dir, { recursive: true, force: true });
    delete process.env.LIPREAD_LLM_API_KEY; delete process.env.LIPREAD_LLM_MODEL; delete process.env.LIPREAD_LLM_URL;
    delete process.env.LIPREAD_SERVICE_URL; delete process.env.LIPREAD_SERVICE_TOKEN;
  }
});
