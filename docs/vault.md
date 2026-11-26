# Secret vault

People keep API tokens, passwords and connection strings in a vault instead of pasting them into prompts. Open your user menu → **Secret vault** to add a secret: a key (`GITHUB_TOKEN`), its value, and a short description for the agent.

The **Secrets of** picker at the top switches between your **Personal** secrets and those of a **project** you can open. Each secret's move button (⇄) moves it between your personal vault and a project, or between projects. A move never overwrites: if the key already exists at the destination, it fails.

Agents get two tools:

- `vault_list_secrets` returns the keys and descriptions of the session owner's personal secrets and the session's project secrets, each marked `personal` or `project`. It never returns values.
- `vault_get_secret` checks that a key exists and returns the placeholder to use for it, never the value. When a key exists in both, the personal one wins unless the agent passes `scope: "project"`.

**Placeholders.** Agents never see secret values. They write `{{vault:KEY}}` (or `{{vault:project:KEY}}`) wherever a value belongs: in a file they write or edit, in a bash command, in any tool argument. The pi extension (`server/extensions/vault.mjs`, helpers in `extensions/lib/vault-redact.mjs`) fills the values in just before the tool runs; the stored tool call keeps the placeholder. A placeholder without a matching secret blocks the call. In every tool result (file reads, command output, edit diffs), each known value is turned back into its placeholder, so an agent that opens a filled file sees `TOKEN={{vault:API_TOKEN}}` and can edit it as shown. Values are refreshed every 30 seconds from `GET /api/vault-bridge/:key?values=1`. Values shorter than 6 characters are not redacted (they would match ordinary text); only pi RPC sessions have the vault tools.

**Encoded values.** Redaction also catches a value's common encodings and labels the placeholder: JSON-escaped (`{{vault:KEY:json}}`, also with `\/`), URL-encoded (`{{vault:KEY:url}}`, also lowercase `%xx` and `+` for spaces), base64 and base64url (`{{vault:KEY:base64}}`, also inside a longer base64 string such as a Basic auth header `user:password`, where a few characters at the edges stay visible), and hex (`{{vault:KEY:hex}}`). A labelled placeholder is filled with the same encoding, so an agent can edit a JSON file it read back as shown. Other transformations (hashes, partial values, other encodings) are not caught, so redaction protects against accidental leaks, not an agent deliberately working around it.

**Live output.** Output streamed to viewers while a tool runs is redacted on the server (`server/src/live-redaction.ts`, registered by `vault.ts`), with the session's values cached for 30 seconds and dropped whenever a secret is added, changed, moved or deleted.

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
