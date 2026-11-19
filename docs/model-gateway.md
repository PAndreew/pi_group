# Model gateway

The standalone gateway forwards OpenAI Chat Completions requests, including streaming tool calls. It is not yet wired into Beezy chat, Pi, or Settings. It does not implement automatic fallback; the trusted caller must choose an account and model before issuing the token.

## Run locally

Requires Node.js 22.19+. From the repository root:

```sh
(umask 077; mkdir -p ~/.beezy-gateway; set -C; openssl rand -hex 32 > ~/.beezy-gateway/admin.token)
node gateway/index.mjs
curl --fail http://127.0.0.1:8791/health
node --test gateway/server.test.mjs
```

The gateway only listens on loopback. `GATEWAY_PORT` and `GATEWAY_DATA_DIR` override the port and data directory. Keys are stored with AES-256-GCM; back up the database and its master key separately. Set `GATEWAY_MASTER_KEY` to supply a 32-byte hex or base64 key rather than generating a master key file.

## HTTP interface

Admin routes require the admin bearer token. Only a trusted backend should call them, and it must derive the account ID from the authenticated tenant and user rather than accepting it from a client.

| Method and path | Purpose |
| --- | --- |
| `PUT /admin/credentials/:account` | Store or rotate `{ "apiKey": "…" }`; returns configuration status only. |
| `GET /admin/credentials/:account` | Check whether a key is configured, without decrypting it. |
| `DELETE /admin/credentials/:account` | Delete a key and revoke that account's runs. |
| `POST /admin/runs` | Issue `{ token, runId, expiresAt }` from `{ account, model, ttlSeconds?, requests?, maxOutputTokens? }`. |
| `DELETE /admin/runs/:runId` | Revoke the run and cancel any active request. |
| `POST /v1/chat/completions` | Use the run token as the bearer credential; the model must match the pinned model. |

Run tokens are memory-only and have a request count, an output-token limit per request, and a maximum 15-minute lifetime. These are not dollar spending caps. The API key is decrypted just before forwarding to the fixed OpenAI endpoint. Provider errors do not trigger a fallback or switch accounts.

**Local trust:** an agent running under the same OS user can access that user's gateway files, including the admin token and master key. This setup is for trusted personal use only. In production, keep the gateway, admin token, and credential storage outside the agent's security boundary; use a private TLS ingress and restrict admin access to the trusted backend.
