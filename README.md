# beezy

A small, mobile-first web UI that lets a **group of people share coding agents running on one machine** (e.g. a Raspberry Pi). It talks to agent *harnesses* through adapters; the first targets are the [pi coding agent](https://github.com/earendil-works/pi) and **pi-durable**.

- Browse the machine's folders and files, upload and download files
- In-app viewers for Markdown, HTML (sandboxed), PDF (pdf.js, works on phones), source code (Python, JS/TS, shell, …), images, audio/video, CSV, JSON
- **Chats, messenger style.** The home screen lists earlier chats; the message box starts a new one:
  - mention `@pi` alone for a pi chat (a regular session), one or more `@people` for a chat between people, or both;
  - add `#folder` (fuzzy search) to choose where pi works, otherwise it uses the shared chat folder (`CHAT_FOLDER`). A chat's folder is fixed;
  - in a chat with people, `@pi` brings pi in: it gets everything said since its last turn, and its reply is posted back. Chat members can open and steer pi's session;
  - messages are stored in pi's message format (role, content, timestamp, author) in `DATA_DIR/chats.sqlite`; existing sessions appear as pi chats.
- **Memory.** Chats untouched for `MEMORY_AFTER_DAYS` (default 7) are consolidated, one at a time, by a "Memory" pi session in the chat folder into `MEMORY.md` (an index) and `memory/<chat>.md`. The folder's `AGENTS.md` tells pi sessions there to consult them. Admins can run it at once from the user menu.
- **One file explorer** (the folder icon under the message box) for everything: open folders, start a session in the current folder with *New session*, and unfold any folder with sessions (count badge, green dot while running) to open, resume or delete them in place, including sessions started with the `pi` CLI
- **Notifications** (user menu → Notifications): a system notification when a run finishes or fails in a session you own, are shared on, or prompted, also with the app closed (Web Push); an in-app toast when it is in front. Needs HTTPS (see below).
- **Installable app (PWA)**: add it to the home screen for a full-screen app; the app shell is cached and the last state of recent sessions is shown at once while the live stream reconnects.
- A home page (click the logo) with your three most recent sessions above a composer that starts a new session in the current folder
- **Account-level session defaults**: save a provider/model/thinking combination from user menu → Session defaults (or the new-session dialog). Defaults persist across devices. New session in either Files or Sessions creates immediately in the current folder using those defaults; without defaults it opens configuration first.
- **Mid-session model switching**: the robot-head button below the chat input opens provider, model and thinking controls; the attachment icon is beside it. Changing a session does not overwrite your saved defaults.
- **Icons under every message box**, each opening its own modal (attach, model, terminal, tools, MCP, monitor, folders):
  - **Terminal** (admins only): a shell on the server in the session's folder, with an Esc/Tab/Ctrl/arrow key bar for phones. If the server runs in Termux, this is the Termux shell. It uses `node-pty` when it could be built, otherwise `python3`; one of them must be available.
  - **pi tools:** the tools the session's agent declared; its slash commands, skills and prompt templates (while it runs); and the extensions, skills, prompts and packages installed in `~/.pi/agent` and the project's `.pi/`. Tapping a command puts it in the message box.
  - **MCP servers:** the servers from `mcp.json`, with live state and tool names from `pi mcp list`. Secrets are never shown, and launch commands only to admins.
  - **Resource monitor:** live sessions with memory (pi process plus the tools it started), CPU, session file size, tokens and cost; system memory and disk meters; load, server memory and event-loop lag. Refreshes every 3 s. Per-process numbers need Linux, Termux or macOS.
- Each run is shown as **a horizontal row of small squares**, one per step (reasoning, shell, read, edit, write, search, other tool, answer), each with an icon and a number. Tap one for the details in a modal, then step through with Prev/Next.
- **Steer** a running agent (delivered after the current tool step), queue a **follow-up**, or **stop** it
- **Session avatars + author filters**: locally generated initials identify each prompt's author. Filter by a person to see their prompts together with the agent's steps and responses; choose Everyone to restore the full conversation. Authorship is recorded from the authenticated account, persists in app metadata, and does not alter model prompts. Older/CLI messages (and indistinguishable identical prompts queued by different people) show **Unknown author**, never the session owner by assumption.
- Runs keep going when you close the browser. A "running" indicator shows what is active, and sessions can be pinned to stay up in the background.
- **Auth + group access**: multiple users, admin/member roles. Sessions are private by default; the owner can share one with chosen users as *view* or *prompt* access.
- Extension dialogs from pi (select / confirm / input) show up as dialogs in the browser.

## Agent protocols: what was considered

| Protocol | What it is | Fit for this app |
|---|---|---|
| **MCP** (Model Context Protocol) | Agent ↔ tools/context servers | Not a UI protocol. The agent uses it for tools (pi has MCP support built in). |
| **ACP** (Agent Client Protocol, Zed) | Editor/UI ↔ agent, JSON-RPC 2.0 over stdio: `session/new`, `session/prompt`, `session/cancel`, `session/update` notifications | The emerging standard for "UI drives an agent". Supported by many agents (Claude Code, Gemini CLI, Codex, and pi through `pi-acp`). The natural **next adapter** here. |
| **A2A** / **AG-UI** | Agent ↔ agent / agent → frontend event streams | Aimed at hosted multi-agent systems, not at local coding harnesses. |
| **pi RPC mode** (`pi --mode rpc`) | JSONL over stdin/stdout: prompt, steer, follow_up, abort, models, thinking, session entries, extension UI | The richest interface to pi. Used by the `pi` adapter. |
| **pi-durable** | A library: a durable harness whose turns, tool calls and queue are committed to SQLite before they show, so runs resume after a crash or restart | Used by the `pi durable` adapter, in process. |

The server normalizes every harness to pi-style messages (`user` / `assistant` with text, thinking and tool-call blocks / `toolResult`). ACP's `session/update` carries the same things (message chunks, thought chunks, tool calls and updates), so an ACP adapter only has to map onto the same `LiveSession` interface (see `server/src/harness/types.ts`).

## Architecture

```
browser (React + shadcn/ui, mobile first)
   │  REST + Server-Sent Events, cookie auth
   ▼
server/ (Node, Express) ── one process on the Pi
   ├─ auth: users, roles, scrypt hashes, server-side login sessions
   ├─ files: FS_ROOT-confined browse / raw / download / upload
   ├─ sessions: ACLs (owner, private/shared, read/write), SSE fan-out, idle reaper
   └─ harness adapters
        ├─ pi          → spawns one `pi --mode rpc` child process per open session
        │                 (lists/reads sessions straight from ~/.pi/agent/sessions/*.jsonl)
        └─ pi durable  → @earendil-works/pi-durable Harness, one SQLite file per folder,
                          reopened and resumed when the server starts
```

- **pi**: each open session is its own `pi` process, so a crash stays contained and sessions stay compatible with the `pi` CLI (`pi --resume` sees them). Only *viewing* a session never starts a process; the transcript is read from its JSONL file. A process starts when someone prompts, and stops after `IDLE_TIMEOUT_MIN` with nobody watching and no run going, unless the session is pinned.
- **pi durable**: runs live in the server process but are durable. Restarting the server (or a power cut) does not lose a run; it continues when the server comes back. Credentials are read from pi's `~/.pi/agent/auth.json` and provider env vars. pi-durable is experimental upstream; if it fails to load, only that adapter is disabled.

## Install on a Raspberry Pi

Requirements: Node.js ≥ 22.19 (arm64), and `pi` installed and logged in to a provider:

```bash
npm install -g @earendil-works/pi-coding-agent
pi            # once, interactively: /login or set an API key env var
```

Then:

```bash
git clone https://github.com/PAndreew/pi_group.git
cd pi_group
cp .env.example .env        # set FS_ROOT, ADMIN_PASSWORD, ...
npm run setup               # installs server + web deps
npm run build
npm start                   # http://<pi-address>:8787
```

On first start an `admin` user is created. Without `ADMIN_PASSWORD` the generated password is printed to the log. Add more users in the UI (user menu → Manage users) or from the shell:

```bash
npm run user -- add alice 'a-long-password'        # member
npm run user -- add bob 'another-password' --admin
npm run user -- list
```

Run it as a service: see [`deploy/pi-group.service`](deploy/pi-group.service).

### Phones and HTTPS

The UI works over plain HTTP on a LAN, but browsers only allow notifications on HTTPS (or `localhost`). Outside your LAN, put it behind HTTPS (e.g. `tailscale serve 8787`, Caddy, nginx) and set `COOKIE_SECURE=true`. SSE needs proxy buffering off (nginx: `proxy_buffering off;`; the server already sends `X-Accel-Buffering: no`).

Install it as an app: Android Chrome → menu → *Install app*; iPhone Safari → Share → *Add to Home Screen*. On iPhone (iOS 16.4+), notifications only work from the installed app, so turn them on there. Push messages go through the browser vendor's push service (Google, Apple, Mozilla; end-to-end encrypted), so the server needs outbound internet. Its VAPID keys are generated into `DATA_DIR/vapid.json` on first use; deleting that file means every device has to turn notifications on again.

## Configuration

All settings are environment variables (or `.env`); see [`.env.example`](.env.example). The important ones:

| Variable | Default | Meaning |
|---|---|---|
| `FS_ROOT` | home directory | Root of the file browser; nothing outside it is reachable (symlink escapes included) |
| `DATA_DIR` | `~/.pi-group` | Users, logins, sharing metadata, pi-durable databases |
| `PI_BIN` | `pi` | pi executable |
| `IDLE_TIMEOUT_MIN` | `30` | Stop idle pi processes |
| `COOKIE_SECURE` | `false` | Set when served over HTTPS |
| `ENABLE_DURABLE` | `true` | Offer the pi durable harness |
| `CHAT_FOLDER` | `FS_ROOT/pi-chat` | Shared folder for chats without a `#folder`; holds the memory files |
| `MEMORY_AFTER_DAYS` | `7` | Consolidate chats idle this long into memory; `0` turns it off |
| `VAPID_SUBJECT` | project URL | Contact (`mailto:` or `https:`) sent to push services |
| `PI_GROUP_DEMO_MODEL` | unset | `1` adds an offline demo model to pi durable, to try the UI without API keys |

## Security model

- Every API route except login needs a valid session cookie (`HttpOnly`, `SameSite=Lax`). State-changing requests also need an `X-Pi-Group` header, which cross-site pages cannot send. Logins are rate-limited.
- Passwords are hashed with scrypt; login tokens are stored only as SHA-256 hashes.
- Session visibility is enforced on the server. Sessions you cannot see return 404. Sessions started outside the app (with the `pi` CLI) have no owner and are visible only to admins, who can assign an owner.
- File previews are served with `Content-Security-Policy: sandbox`, and HTML is rendered in an `<iframe sandbox>` without `allow-same-origin`, so a previewed page can never act as the logged-in user.
- **Trust boundary:** an agent runs with the OS permissions of the server's user, and anyone who can prompt a session can make the agent run shell commands on the Pi. Only give accounts (and *prompt* access) to people you would give a shell to. The file browser lets every logged-in user read and upload anywhere under `FS_ROOT`; choose it accordingly.

## Development

```bash
npm run setup
npm run dev:server     # API on :8787 (tsx watch)
npm run dev:web        # Vite on :5173, proxies /api to :8787
npm test --prefix server # authorship, defaults and authenticated preferences API tests
npm run lint --prefix web
npm run build
```

Code map:

- `server/src/harness/types.ts`: the adapter interface (`HarnessAdapter`, `LiveSession`, normalized `SessionState` and events)
- `server/src/harness/pi-rpc.ts`: pi RPC adapter (strict LF-delimited JSONL framing, as pi's docs require)
- `server/src/harness/pi-durable.ts`: pi-durable adapter (`watchEvents` → normalized events)
- `server/src/sessions.ts`: session API, ACLs, SSE hub, idle reaper
- `web/src/lib/steps.ts`: turns messages into runs and steps for the strip
- `web/src/components/step-strip.tsx`, `step-dialog.tsx`: the step squares and their detail modal

### Adding a harness

Implement `HarnessAdapter` (list/read sessions, models, `open`/`create` returning a `LiveSession`) and register it in `server/src/index.ts`. `LiveSessionBase` handles state, throttled streaming and fan-out. An adapter maps its protocol's events to `pushMessage`, `partial`, tool output and status updates.

## License

MIT
