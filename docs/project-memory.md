# Project memory and session archives

Every non-General project already has a generated `projects/<name>/` folder under its tenant file root. General uses the tenant chat folder. Linked repositories do not become the memory storage location.

Memory updates itself; there is no schedule to set. When a session someone worked in goes quiet, the server waits until **30 seconds before its provider's prompt cache expires** and then sends that session's own agent a short housekeeping prompt asking it to fold what the conversation added into the project's memory. The agent already has the whole conversation in context and the prompt is still cached, so this costs a fraction of re-reading the conversation in a separate worker. A run ending restarts the wait; a new prompt pushes it back.

**Cache lifetime per provider** is set in Model settings → Project memory → Memory update timing (admins change it, `GET|PUT /api/memory-cache`). The provider is the live agent's model provider, else the owner's default model's. Defaults are the providers' cache lifetimes as pi requests them: 5 minutes for Anthropic, OpenAI, Google and most others; with `PI_CACHE_RETENTION=long`, 60 minutes for Anthropic and OpenAI (OpenAI's 24 hours capped to an hour); DeepSeek 60.

**Group chats** take part too; the last message sent marks their activity. A chat with pi in it uses its pi session, timed by that session's provider: the session gets the update prompt plus what people said since pi's last turn (pi then counts as having seen it), queued like an @pi turn so nothing interleaves, and no reply is posted to the chat. A chat without pi has no cache to catch: `MEMORY_IDLE_MINUTES` (default 15) after its last message, a short-lived hidden worker reads the messages since the chat's last update (last 40,000 characters) and is removed afterwards. Every member must have project access.

Only sessions and chats with activity since the server started are considered: old ones are never swept up, and after a restart they take part again once someone works in them. Private sessions, applets and sessions whose viewers lack project access never update memory. The update prompt does not count as activity, does not move the session up the list and does not title it.

## Topics and the overview

Memory is a short **overview** plus a set of **topics**, one Markdown file each, chosen to fit the project: architecture, design, marketing and business for a product, or itinerary and budget for a family trip. Agents create topics as material appears, and merge or delete thin ones. A project has at most 10 topics, each at most 8,000 characters; the overview at most 1,500.

- `memory/overview.md`: a few sentences that orient someone new: what the project is, its current focus, where to look.
- `memory/topics/<slug>.md`: one topic. It starts with a header giving a `title` and a one-line `description`, which agents use to decide whether to read it.
- `MEMORY.md`: the master the server **generates** from the overview and the topic headers. Never edit it by hand.
- `memory/archives/<id>.json.gz`: losslessly compressed session metadata and messages. Harness originals are retained as well; archiving is not deletion.

**What agents get.** Only the master is put in front of the first prompt of each agent runtime, and again after it changes. This also works for sessions started in linked repositories. The master tells the agent to read only the topics relevant to its task, with the `project_memory` tool, which pi and pi durable sessions both have:
- `topics` reads whole topics by name;
- `query` finds matching lines across all topics;
- with neither, it lists the topics.

**Agents write memory** with `project_memory_update`: `action=write` creates or replaces a whole topic (`topic`, `title`, `description`, `body`), `action=delete` removes one, `action=overview` replaces the overview. Every change is validated (slug, required header fields, size and topic limits) and the master is regenerated right away; a rejected change comes back to the agent as text saying why. Agents may use it whenever asked to, not only in the quiet-session update. Both tools act with the session owner's access, under the same rules as the master (see Privacy); private sessions can read but not write.

**People edit memory.** In Model settings → Project memory, anyone with access to the project can edit the overview and create, edit and delete topics. Agents are told to keep what people wrote unless a conversation clearly supersedes it.

**From before topics.** A `MEMORY.md` written before topics is moved to `memory/legacy-master.md`. Agents keep getting it unchanged until the first memory update splits it into topics and an overview; it is removed once an agent writes a topic or the overview.

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

A session is hidden from ordinary session lists only once its memory update has finished after its last activity (checked hourly), and only if:

- it is not explicitly private, deleted, a group-chat backing session or a memory worker;
- recorded prompt authorship identifies exactly its initiating owner (unknown or multiple authors are retained conservatively);
- it is idle and has no activity within the past 24 hours;
- it is not marked **Keep live**.

The session menu's Keep live option is independent of keeping an agent process running in the background. Project memory settings show an archive list with **Restore & keep live**, which restores the original session and prevents immediate rearchiving. Archived sessions cannot receive prompts until restored. Existing access checks still apply. The archive list contains only sessions the viewer can access.

## Replacement of legacy memory

`MEMORY_AFTER_DAYS` and the tenant-wide consolidation endpoint are removed. Legacy tenant memory workers are retired; their `MEMORY.md` indexes are renamed `MEMORY.legacy-<timestamp>.md` rather than imported into new public memory. Old detailed files are preserved, not deleted. New memory is rebuilt from eligible project sources.

## API

- `GET|PUT /api/memory-cache`: prompt-cache minutes per provider (`{ "anthropic": 60 }`, `null` = default); PUT is admin-only.
- `GET /api/memory/:projectId`: context trimming, sessions updating memory now, last update, latest error, overview, topics (slug, title, description, updated, size), limits, whether a master from before topics is waiting.
- `PATCH /api/memory/:projectId` with `{ "context": { "trimHours": 12, "windowHours": 168 } }` (project creator or admin).
- `PUT /api/memory/:projectId/overview` with `{ "body" }`: replace the overview (empty removes it).
- `GET|PUT|DELETE /api/memory/:projectId/topics/:slug`: read, create or replace (`{ "title", "description", "body" }`), delete a topic. Anyone with project access; 409 when an 11th topic would be created.
- `GET /api/memory/:projectId/archives`: accessible archived sessions.
- `PATCH /api/sessions/:key/retention`: `memoryPrivate`, `keepLive`, or `archived: false` to restore.
- `POST /api/sessions` accepts `memoryPrivate` (default false).
- `POST /api/memory-bridge/:key` and `POST /api/memory-bridge/:key/update` (session bridge credential): the pi extension's `project_memory` and `project_memory_update` tools.

The separate batch consolidation worker, its schedule, model setting and manual "Consolidate now" were removed.
