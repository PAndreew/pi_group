import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { providers, providerRequest } from './providers.mjs';

const digest = value => createHash('sha256').update(value).digest();
const json = (res, status, body) => res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(body));
const fail = (status, message) => Object.assign(new Error(message), { status });
async function body(req, max) {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw fail(415, 'Expected application/json');
  const parts = []; let size = 0;
  for await (const part of req.iterator({ destroyOnReturn: false })) {
    size += part.length;
    if (size > max) { req.resume(); throw fail(413, 'Request too large'); }
    parts.push(part);
  }
  try {
    const value = JSON.parse(Buffer.concat(parts));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch { throw fail(400, 'Expected a JSON object'); }
}

export function createGateway({ store, adminToken, fetchUpstream = fetch, now = Date.now }) {
  if (!adminToken || adminToken.length < 32) throw new Error('Gateway admin token must be at least 32 characters');
  const adminHash = digest(adminToken);
  const runs = new Map();
  function revoke(id) { runs.get(id)?.controller?.abort(); runs.delete(id); }
  const server = createServer(async (req, res) => {
    const token = /^Bearer ([\w.-]+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? (req.url === '/v1/messages' ? req.headers['x-api-key'] : '') ?? '';
    const hash = digest(token);
    const id = hash.toString('hex');
    const route = req.url;
    try {
      if (route === '/health' && req.method === 'GET') return json(res, 200, { ok: true });
      if (route?.startsWith('/admin/')) {
        if (!timingSafeEqual(hash, adminHash)) throw fail(401, 'Unauthorized');
        const credentialRoute = /^\/admin\/credentials\/([A-Za-z0-9_-]{1,100})(?:\/([a-z]+))?$/.exec(route);
        const account = credentialRoute?.[1];
        const provider = credentialRoute?.[2] ?? 'openai';
        if (account && !providers.has(provider)) throw fail(400, 'Unsupported provider');
        if (account) {
          if (req.method === 'PUT') {
            const { apiKey } = await body(req, 8192);
            if (typeof apiKey !== 'string' || !/^[\x21-\x7e]{8,4096}$/.test(apiKey)) throw fail(400, 'Invalid API key');
            store.put(account, provider, { value: apiKey });
            for (const [key, run] of runs) if (run.account === account && run.provider === provider) revoke(key);
            return json(res, 200, { configured: true });
          }
          if (req.method === 'GET') return json(res, 200, { configured: store.list(account).some(row => row.key === provider) });
          if (req.method === 'DELETE') {
            store.delete(account, provider);
            for (const [key, run] of runs) if (run.account === account && run.provider === provider) revoke(key);
            return json(res, 200, { configured: false });
          }
        }
        if (route === '/admin/runs' && req.method === 'POST') {
          const { account, model, provider = 'openai', ttlSeconds = 300, requests = 8, maxOutputTokens = 4096 } = await body(req, 8192);
          if (typeof account !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(account) || typeof model !== 'string' || !/^[A-Za-z0-9_./:-]{1,200}$/.test(model) || !providers.has(provider) || !bounded(ttlSeconds, 1, 900) || !bounded(requests, 1, 32) || !bounded(maxOutputTokens, 1, 16384)) throw fail(400, 'Invalid run configuration');
          if (!store.list(account).some(row => row.key === provider)) throw fail(409, 'No credential configured for this account');
          for (const [key, run] of runs) if (run.expiresAt <= now()) revoke(key);
          if (runs.size >= 1000) throw fail(503, 'Too many active runs');
          const issued = randomBytes(32).toString('base64url');
          const runId = digest(issued).toString('hex');
          const expiresAt = now() + ttlSeconds * 1000;
          runs.set(runId, { account, provider, model, expiresAt, remaining: requests, maxOutputTokens });
          return json(res, 201, { token: issued, runId, expiresAt });
        }
        const runId = /^\/admin\/runs\/([a-f0-9]{64})$/.exec(route)?.[1];
        if (runId && req.method === 'DELETE') { revoke(runId); return json(res, 200, { ok: true }); }
        throw fail(404, 'Not found');
      }
      if (!['/v1/chat/completions', '/v1/messages'].includes(route) || req.method !== 'POST') throw fail(404, 'Not found');
      const run = runs.get(id);
      if (!run || run.expiresAt <= now()) throw fail(401, 'Invalid or expired run token');
      const provider = providers.get(run.provider);
      if (route !== (provider.native ? '/v1/messages' : '/v1/chat/completions')) throw fail(400, 'Request format does not match the pinned provider');
      const input = await body(req, 512 * 1024);
      if (runs.get(id) !== run || run.expiresAt <= now()) throw fail(401, 'Invalid or expired run token');
      if (input.model !== run.model || !Array.isArray(input.messages) || input.messages.length === 0) throw fail(400, 'Expected messages and the pinned model');
      const limit = input.max_completion_tokens ?? input.max_tokens ?? run.maxOutputTokens;
      if (!bounded(limit, 1, run.maxOutputTokens)) throw fail(400, 'Output token limit exceeds run allowance');
      if (run.controller) throw fail(409, 'A request is already active for this run');
      if (!run.remaining) throw fail(429, 'Run request budget exhausted');
      run.remaining--;
      const controller = run.controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), Math.max(1, run.expiresAt - now()));
      const disconnect = () => controller.abort();
      res.once('close', disconnect);
      try {
        const credential = store.get(run.account, run.provider);
        if (!credential) throw fail(409, 'Credential removed');
        const { headers, payload } = providerRequest(provider, run.model, input, limit, credential.value);
        const upstream = await fetchUpstream(provider.url, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers, body: JSON.stringify(payload),
        });
        if (!upstream.ok || !upstream.body) {
          await upstream.body?.cancel();
          throw fail([401, 403, 429].includes(upstream.status) ? upstream.status : 502, 'Provider rejected the request');
        }
        res.writeHead(200, { 'content-type': payload.stream ? 'text/event-stream' : 'application/json', 'cache-control': 'no-store' });
        await pipeline(Readable.fromWeb(upstream.body), res, { signal: controller.signal });
      } finally {
        clearTimeout(timeout); res.off('close', disconnect); run.controller = undefined;
      }
    } catch (error) {
      if (res.headersSent || res.destroyed) { res.destroy(); return; }
      json(res, error.status ?? 502, { error: { message: error.status ? error.message : 'Gateway request failed' } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  return server;
}

function bounded(n, min, max) { return Number.isInteger(n) && n >= min && n <= max; }
