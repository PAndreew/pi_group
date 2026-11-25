# Project memory and session archives

Every non-General project already has a generated `projects/<name>/` folder under its tenant file root. General uses the tenant chat folder. Linked repositories do not become the memory storage location.

Memory updates itself through an **hourly sync per project** (`MEMORY_SYNC_MINUTES`, default 60, at most once per that interval). The server checks every 5 minutes; when a project's last sync is an hour old and its conversations have something new, it:

1. collects every message since the last sync from the project's sessions and group chats (a chat's pi session is covered by the chat itself);
2. strips them to the discussion: what people and agents said. Thinking, images, injected project memory and tool results are left out; tool calls shrink to one `[tools: edit server/src/x.ts; bash npm test ×2]` line, failed results to a short error. Long conversations keep their newest part (about 150,000 characters in all);
3. starts a short-lived session with the project's creator (else the most active participant with project access), on the **memory sync model** of their default provider, with thinking low. Its prompt holds the current overview and all topics in full, plus the digest;
4. the session updates topics and the overview with `project_memory_update` and is then **deleted** (runtime, harness file and metadata). Sync sessions never show in session lists; one left over by a restart is removed at startup.

The conversations themselves are never prompted or changed, so nobody waits for memory and no housekeeping piles up in their context. Without anything new, no session is started. A failed sync is retried an hour later with the same messages.

**Memory sync model** (Model settings → Project memory, `GET|PUT /api/memory-model`, admins change it): per provider, the configured model, else the provider's cheapest by listed price (input weighted 3:1 over output, since a sync mostly reads), else a light model by name (haiku, mini, flash, …), else the owner's default model.

Only messages after the server first started with this design are synced (the first cursor is the server start, or the project's last update); old conversations are never swept up. Private sessions, applets and sessions or chats whose viewers or members lack project access are left out.

## Topics and the overview

Memory is a short **overview** plus a set of **topics**, one Markdown file each, chosen to fit the project: architecture, design, marketing and business for a product, or itinerary and budget for a family trip. Agents create topics as material appears, and merge or delete thin ones. A project has at most 10 topics, each at most 8,000 characters; the overview at most 1,500.

- `memory/overview.md`: a few sentences that orient someone new: what the project is, its current focus, where to look.
- `memory/topics/<slug>.md`: one topic. It starts with a header giving a `title` and a one-line `description`, which agents use to decide whether to read it.
- `MEMORY.md`: the master the server **generates** from the overview and the topic headers. Never edit it by hand.
- `memory/archives/<id>.json.gz`: losslessly compressed session metadata and messages. Harness originals are retained as well; archiving is not deletion.

**What agents get.** Only the master is put in front of a prompt, at most once per rolling 24 hours per session (sync sessions never get it; their prompt holds the topics). Changes made meanwhile reach the agent at the next injection or through `project_memory`. This also works for sessions started in linked repositories. The master tells the agent to read only the topics relevant to its task, with the `project_memory` tool, which pi and pi durable sessions both have:
- `topics` reads whole topics by name;
- `query` finds matching lines across all topics;
- with neither, it lists the topics.

**Agents write memory** with `project_memory_update`: `action=write` creates or replaces a whole topic (`topic`, `title`, `description`, `body`), `action=delete` removes one, `action=overview` replaces the overview. Every change is validated (slug, required header fields, size and topic limits) and the master is regenerated right away; a rejected change comes back to the agent as text saying why. Agents may use it whenever asked to, not only in the hourly sync. Both tools act with the session owner's access, under the same rules as the master (see Privacy); private sessions can read but not write.

**People edit memory.** In Model settings → Project memory, anyone with access to the project can edit the overview and create, edit and delete topics. Agents are told to keep what people wrote unless a conversation clearly supersedes it.

**From before topics.** A `MEMORY.md` written before topics is moved to `memory/legacy-master.md`. Agents keep getting it unchanged until the first memory sync splits it into topics and an overview; it is removed once an agent writes a topic or the overview.

## Context trimming

Long conversations, especially between people and agents, otherwise send their entire history on every model request. Each project has two settings under Model settings → Project memory → Agent context. Both apply to pi and pi durable sessions.

- **Trim turns after N hours** (default 12, 0 = never). A turn runs from a user message to the next one. Once a turn ended more than N hours ago, the model no longer sees its reasoning. Each tool call keeps its name, with arguments clipped to about 120 characters, and each result shrinks to its first line plus a note of what was cut (`… [trimmed: 48 lines, 3120 chars, 1 image]`). What people and the agent said stays.
- **Show last N hours** (default 168, 0 = all). Turns that ended before that are left out. A note on the first message the agent does see says how many messages are hidden and from when, and points to the `session_history` tool.

`session_history` searches the complete stored conversation (`query`) or reads it from a message number (`from`) or a time (`date`), 12,000 characters per page, with tool output up to 1,500 characters per result.

Only the copy sent with each request changes. The session file, durable SQLite, UI and archives keep everything. The turn in progress is never touched.

**Prompt cache.** The cutoffs are fixed when an agent starts working: on the first request of a runtime, or after an hour without requests (by then the provider's prompt cache has expired anyway). They do not move during active work, so the start of the prompt stays identical and cached. Settings changes take effect at the next such point.

**Project memory copies.** The master is put in front of the first prompt of every runtime and is stored with that message. Only the newest copy is sent. If it falls in the hidden window, it moves into the note.

Implementation: `server/extensions/lib/context-policy.mjs` is shared by the pi extension `server/extensions/context-policy.mjs` (pi's `context` event; it reads the project settings over `/api/context-bridge/:key`) and pi durable's `beforeRequest` generation hook in `server/src/harness/pi-durable.ts`.

## Privacy

Session sharing controls who can open the conversation. **Private session** is a separate explicit memory opt-out, available at creation or through the session menu. Default sessions contribute to common project memory even when the conversation itself is not shared. Private sessions never contribute; they can read common project memory. There is no private-memory consolidation.

Project memory is supplied only where the initiating user and all explicitly listed session viewers have project access. Memory files are project context, not a new filesystem security boundary: as elsewhere in this app, OS-level agent isolation is separate.

A session that has already added to memory cannot be made private retroactively through the toggle: its earlier contributions may already have been read. Deliberate cleanup requires reviewing the topics. Avoid secrets in public sessions.

## Archive eligibility

A session is hidden from ordinary session lists only once a memory sync has read it after its last activity (checked hourly), and only if:

- it is not explicitly private, deleted, a group-chat backing session or a memory worker;
- recorded prompt authorship identifies exactly its initiating owner (unknown or multiple authors are retained conservatively);
- it is idle and has no activity within the past 24 hours;
- it is not marked **Keep live**.

The session menu's Keep live option is independent of keeping an agent process running in the background. Project memory settings show an archive list with **Restore & keep live**, which restores the original session and prevents immediate rearchiving. Archived sessions cannot receive prompts until restored. Existing access checks still apply. The archive list contains only sessions the viewer can access.

## Replacement of legacy memory

`MEMORY_AFTER_DAYS` and the tenant-wide consolidation endpoint are removed. Legacy tenant memory workers are retired; their `MEMORY.md` indexes are renamed `MEMORY.legacy-<timestamp>.md` rather than imported into new public memory. Old detailed files are preserved, not deleted. New memory is rebuilt from eligible project sources.

## API

- `GET|PUT /api/memory-model`: the sync model per provider (`{ "anthropic": "claude-haiku-4-5" }`, `null` = cheapest); PUT is admin-only.
- `GET /api/memory/:projectId`: context trimming, whether a sync runs now, next sync, last update, latest error, overview, topics (slug, title, description, updated, size), limits, whether a master from before topics is waiting.
- `PATCH /api/memory/:projectId` with `{ "context": { "trimHours": 12, "windowHours": 168 } }` (project creator or admin).
- `PUT /api/memory/:projectId/overview` with `{ "body" }`: replace the overview (empty removes it).
- `GET|PUT|DELETE /api/memory/:projectId/topics/:slug`: read, create or replace (`{ "title", "description", "body" }`), delete a topic. Anyone with project access; 409 when an 11th topic would be created.
- `GET /api/memory/:projectId/archives`: accessible archived sessions.
- `PATCH /api/sessions/:key/retention`: `memoryPrivate`, `keepLive`, or `archived: false` to restore.
- `POST /api/sessions` accepts `memoryPrivate` (default false).
- `POST /api/memory-bridge/:key` and `POST /api/memory-bridge/:key/update` (session bridge credential): the pi extension's `project_memory` and `project_memory_update` tools.

The in-session update just before the prompt cache expired (with per-provider cache timings) was replaced by the hourly sync: it made people wait behind housekeeping turns and ran on the session's expensive model.
