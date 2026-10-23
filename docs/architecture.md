# Architecture

Beezy has one open-source codebase with two deployment targets: self-hosted (one `npm start` on a Raspberry Pi, laptop or VPS) and a hosted cloud version. The app code talks to **ports**, which are interfaces for what it needs from the place it runs. Each target plugs in its own **adapters**.

```
                ┌──────────────────────────────────────────────┐
                │  Web app (React PWA, the same for both)      │
                └──────────────────────┬───────────────────────┘
                                       │ HTTPS + live streams;  GET /api/capabilities
┌──────────────────────────────────────▼───────────────────────────────────────────────┐
│ CONTROL PLANE: accounts, tenants, access, chats, sessions, jobs, vault, usage        │
│   later: event pipeline (emit → queue → Clairic extraction → items → Clef triage)    │
│                                                                                      │
│ PORTS: DocumentStore · SqlDatabase · WorkspaceStorage · Realtime · Sandbox ·         │
│        Scheduler · Secrets · Models            (later: Queue · Billing)              │
└──────────────┬───────────────────────────────────────────────────────┬───────────────┘
               │ self-hosted adapters (ports/node.ts)                  │ cloud adapters (planned)
┌──────────────▼──────────────────────────┐   ┌────────────────────────▼──────────────────────┐
│ JSON files and node:sqlite in DATA_DIR  │   │ D1 + Durable Object SQLite                    │
│ filesystem under FS_ROOT                │   │ R2 (user and group prefixes)                  │
│ in-memory topics → SSE                  │   │ Durable Objects + WebSockets                  │
│ local processes                         │   │ container per user, started on demand         │
│ setInterval                             │   │ Durable Object alarms / Cron Triggers         │
│ vault/ service over HTTP                │   │ vault as a Durable Object                     │
│ models: none, or local / API            │   │ models: Workers AI / API                      │
└─────────────────────────────────────────┘   └───────────────────────────────────────────────┘
                        │                                  │
                        ▼                                  ▼
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ AGENT HOST (planned split): pi over RPC, tools (read/write/edit/bash/MCP), workspace,│
│ terminal, file API, usage records. In-process at home, in a container in the cloud.  │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

## Ports

All ports are defined in [`server/src/ports/index.ts`](../server/src/ports/index.ts), and the self-hosted adapters are in [`server/src/ports/node.ts`](../server/src/ports/node.ts). `platform()` returns the adapters in use. A deployment calls `setPlatform()` once at startup, before anything uses them.

| Port | Self-hosted adapter | Used by |
|---|---|---|
| `DocumentStore` | atomic JSON files in `DATA_DIR` | app state (`db.json`), push keys |
| `SqlDatabase` | `node:sqlite` in `DATA_DIR` | chats |
| `WorkspaceStorage` | filesystem under `FS_ROOT` (tenant root), symlink-safe | file browser, editor, uploads, previews |
| `Realtime` | in-memory topics, delivered over SSE | session viewers, per-user notification streams |
| `Sandbox` | `child_process` (process groups for tree kills) | pi RPC processes, `pi` CLI calls, job scripts |
| `Scheduler` | `setTimeout` / `setInterval`, never keeping the process alive | jobs, memory consolidation, session housekeeping |
| `Secrets` | the [vault service](vault.md) over HTTP | vault routes, agent vault tools |
| `Models` | every capability `none` | `GET /api/capabilities` |

The `Models` port is where the optional models plug in: `triage` (Clef), `extract` (Clairic), `stt`, `tts` and `embed`. Each one is `none`, `local` or `api`. With all of them `none`, the app behaves exactly as without them, and the web app reads `/api/capabilities` to decide which features to show.

Some parts still use Node directly, because they belong to the future agent host, or because an object-storage adapter will need its own routes:
- the terminal's pty
- the pi-durable harness
- pi's session files
- the resource monitor's process table
- streaming file downloads and multipart uploads, through `WorkspaceStorage.localPath`

## Next steps

1. Split out the agent host behind a protocol, still running in-process when self-hosted.
2. Event pipeline and capability adapters: Clairic extraction, then Clef triage, all off by default.
3. Cloudflare adapters: a Worker, a Durable Object per chat and session, D1, R2 with workspace snapshots, and a container per user's agent host.
4. Metering and billing from the usage records, container time and storage.
5. Speech-to-text and text-to-speech through the same capability registry.
