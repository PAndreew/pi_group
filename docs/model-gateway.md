# Model gateway

The standalone gateway forwards model requests, including streaming tool calls, to fixed provider endpoints. It preserves the provider's response format rather than translating between formats. Beezy uses this gateway for personal model turns in the Pi RPC runtime. In the Beezy server environment, set `BEEZY_GATEWAY_URL=http://127.0.0.1:8791` and `BEEZY_GATEWAY_TOKEN_FILE` to the absolute path of the gateway's `admin.token`, then restart Beezy and reopen any live Pi sessions. Under **Model settings → Personal keys**, save a provider key and choose a preferred model by its exact provider ID. A fallback is optional and is used only if the preferred key is missing; a rejected request never changes payer. Remove the preferred personal model to return to the shared runtime settings.

## Run locally

Requires Node.js 22.19+. From the repository root:

```sh
(umask 077; mkdir -p ~/.beezy-gateway; set -C; openssl rand -hex 32 > ~/.beezy-gateway/admin.token)
node gateway/index.mjs
curl --fail http://127.0.0.1:8791/health
node --test gateway/server.test.mjs
BEEZY_TEST_PI="$PWD/.runtime/node_modules/.bin/pi" node --test gateway/pi-rpc.test.mjs
```

The gateway only listens on loopback. `GATEWAY_PORT` and `GATEWAY_DATA_DIR` override the port and data directory. Keys are stored with AES-256-GCM; back up the database and its master key separately. Set `GATEWAY_MASTER_KEY` to supply a 32-byte hex or base64 key rather than generating a master key file.

## HTTP interface

Admin routes require the admin bearer token. Only a trusted backend should call them, and it must derive the account ID from the authenticated tenant and user rather than accepting it from a client.

| Method and path | Purpose |
| --- | --- |
| `PUT /admin/credentials/:account/:provider` | Store or rotate `{ "apiKey": "…" }`; returns configuration status only. |
| `GET /admin/credentials/:account/:provider` | Check whether a key is configured, without decrypting it. |
| `DELETE /admin/credentials/:account/:provider` | Delete a key and revoke that account's runs for the provider. |
| `POST /admin/runs` | Issue `{ token, runId, expiresAt }` from `{ account, provider?, model, ttlSeconds?, requests?, maxOutputTokens? }`. |
| `DELETE /admin/runs/:runId` | Revoke the run and cancel any active request. |
| `POST /v1/chat/completions` | Use the run token as the bearer credential; the model must match the pinned model. |

Run tokens are memory-only and have a request count, an output-token limit per request, and a maximum 15-minute lifetime. These are not dollar spending caps. `/admin/credentials/:account` and an omitted `provider` still select OpenAI. Run tokens are scoped to an account, provider, and model. The API key is decrypted just before forwarding to that provider's fixed endpoint. Provider errors do not trigger a fallback or switch accounts.

| Provider ID | Request path and format |
| --- | --- |
| `openai` | `/v1/chat/completions` · OpenAI |
| `openrouter` | `/v1/chat/completions` · OpenAI-compatible; use `vendor/model` IDs |
| `gemini` | `/v1/chat/completions` · Google's OpenAI compatibility API, not native Gemini |
| `zhipu` | `/v1/chat/completions` · Zhipu BigModel China endpoint |
| `anthropic` | `/v1/messages` · native Anthropic Messages; accepts the run token as bearer or `x-api-key` |

**Local trust:** an agent running under the same OS user can access that user's gateway files, including the admin token and master key. This setup is for trusted personal use only. In production, keep the gateway, admin token, and credential storage outside the agent's security boundary; use a private TLS ingress and restrict admin access to the trusted backend.
