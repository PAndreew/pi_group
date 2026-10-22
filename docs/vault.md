# Secret vault

People keep API tokens, passwords and connection strings in a vault instead of pasting them into prompts. Open your user menu → **Secret vault** to add a secret: a key (`GITHUB_TOKEN`), its value, and a short description for the agent.

Agents get two tools:

- `vault_list_secrets` returns the session owner's keys and descriptions, never values.
- `vault_get_secret` returns one value by its key.

The UI hides values returned by `vault_get_secret`, but the agent's session history still contains them. Anyone the session is shared with can read that history, so share sessions that use secrets only with people who may see those secrets.

## Who can see which secrets

Secrets belong to one person in one tenant (Work and Family are separate). In a session, the agent uses the owner's vault, even when someone else wrote the prompt. In a group chat, it uses the vault of the person whose first `@pi` mention created the chat's session.

## Running it

The vault is a separate service in [`vault/`](../vault). It has no dependencies, keeps secrets in SQLite and encrypts each value with AES-256-GCM. The service knows nothing about Beezy's users: Beezy authenticates with a shared token and chooses the namespace (`tenant.userId`). That lets you move the vault to other hardware, or later into an enclave, without changing Beezy.

1. Generate a token (`openssl rand -hex 32`) and set `VAULT_TOKEN=` in `.env`.
2. Start the vault: `npm run start:vault`. For a permanent service, use [`deploy/beezy-vault.service`](../deploy/beezy-vault.service).
3. Restart Beezy. If the vault runs on another machine, set `VAULT_URL` too, and put TLS or a private network such as WireGuard or Tailscale in front of it.

On the vault side:

| Setting | Default | Meaning |
|---|---|---|
| `VAULT_TOKEN` | — (required) | Bearer token Beezy uses; at least 24 characters. |
| `VAULT_HOST` / `VAULT_PORT` | `127.0.0.1` / `8790` | Listen address. |
| `VAULT_DATA_DIR` | `~/.beezy-vault` | SQLite database and generated master key. |
| `VAULT_MASTER_KEY` | generated `master.key` | 32-byte encryption key (base64 or hex). Back it up: without it the secrets cannot be read. |

Beezy removes `VAULT_TOKEN` from its own environment at startup, so agent processes, terminals and job scripts do not inherit it. When the vault runs on the same machine as the same OS user, anyone with shell access can still read `.env` and the key file. Real isolation needs a separate user or machine.

## API

All routes except `/health` require `Authorization: Bearer $VAULT_TOKEN`.

```
GET    /health
GET    /v1/namespaces/:ns/secrets          → { secrets: [{ key, description, createdAt, updatedAt }] }
GET    /v1/namespaces/:ns/secrets/:key     → { key, description, value, createdAt, updatedAt }
PUT    /v1/namespaces/:ns/secrets/:key     { value?, description? }
DELETE /v1/namespaces/:ns/secrets/:key
```
