# Secret vault

People keep API tokens, passwords and connection strings in a vault instead of pasting them into prompts. Open your user menu → **Secret vault** to add a secret: a key (`GITHUB_TOKEN`), its value, and a short description for the agent.

The **Secrets of** picker at the top switches between your **Personal** secrets and those of a **project** you can open. Each secret's move button (⇄) moves it between your personal vault and a project, or between projects. A move never overwrites: if the key already exists at the destination, it fails.

Agents get two tools:

- `vault_list_secrets` returns the keys and descriptions of the session owner's personal secrets and the session's project secrets, each marked `personal` or `project`. It never returns values.
- `vault_get_secret` returns one value by its key. When a key exists in both, the personal one wins unless the agent passes `scope: "project"`.

Exception: a key configured as `CLOUDFLARE_VAULT_KEY` is reserved for [server-side Cloudflare assistance](cloudflare-assistance.md). It is hidden from agent listings and cannot be read through the agent bridge. Users can still manage it in the vault UI. Assistance resolves the initiating user's key in the run's tenant, rather than using the session owner's credential.

The UI hides values returned by `vault_get_secret`, but the agent's session history still contains them. Anyone the session is shared with can read that history, so share sessions that use secrets only with people who may see those secrets.

## Who can see which secrets

Secrets belong to one person in one tenant (Work and Family are separate). In a session, the agent uses the owner's vault, even when someone else wrote the prompt. In a group chat, it uses the vault of the person whose first `@pi` mention created the chat's session.

Project secrets belong to a project. Everyone who can open the project can see, change, move and delete them. General is open to the whole tenant, so its secrets are too. An agent reads a project's secrets when its session (or the chat it belongs to) is in that project and the session owner is still a member of it. A project that still holds secrets can't be deleted: move or delete them first.

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

Beezy uses the namespace `tenant.userId` for personal secrets and `tenant.project.projectId` for project secrets. Its own routes take `?project=<id>` to address a project's secrets, and `POST /api/vault/secrets/:key/move` with `{ "project": "<id>" | null }` moves a secret (`null` means the caller's personal vault).
