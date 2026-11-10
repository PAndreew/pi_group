# Project memory and session archives

Every non-General project already has a generated `projects/<name>/` folder under its tenant file root. General uses the tenant chat folder. Linked repositories do not become the memory storage location.

Model settings → Project memory configures the **selected project's** interval in hours. Zero disables automatic runs; manual runs remain available. Only the project creator or a tenant admin with project access can change the schedule or run consolidation. New projects default to off. Failed runs expose an error and can be retried. Automatic checks run every minute; missed schedules run after the server comes back.

## Topics

Memory is a set of **topics**, one Markdown file each, chosen to fit the project: architecture, design and business for a product, or itinerary and budget for a family trip. Topics come and go as the project evolves. There is no marketing topic until there is enough marketing material to warrant one, and a topic that has become thin is merged into another. A project has at most 10 topics, each at most 8,000 characters.

- `memory/topics/<slug>.md`: one topic. It starts with a header giving a `title` and a one-line `description`, which agents use to decide whether to read it.
- `MEMORY.md`: an index the server **generates** from the topic headers. Never edit it by hand.
- `memory/archives/<id>.json.gz`: losslessly compressed session metadata and messages. Harness originals are retained as well; archiving is not deletion.
- `memory/manifest.json`: how many messages of each source have been consolidated.

**What agents get.** Only the index is put in front of the first prompt of each agent runtime, and again after it changes. This also works for sessions started in linked repositories. The index tells the agent to read only the topics relevant to its task, with the `project_memory` tool, which pi and pi durable sessions both have:
- `topics` reads whole topics by name;
- `query` finds matching lines across all topics;
- with neither, it lists the topics.

The tool answers with the session owner's access, under the same rules as the index (see Privacy).

**People edit topics.** In Model settings → Project memory, anyone with access to the project can create, edit and delete topics. Edits are blocked while a run is in progress, because the run works on a copy of the topics. Workers are told to keep what people wrote unless a conversation clearly supersedes it.

**From before topics.** A `MEMORY.md` written before topics is moved to `memory/legacy-master.md`. Agents keep getting it unchanged until the first run splits it into topics, together with any old snapshots that were never merged. Old snapshot files stay where they are.

## How a run works

1. **Digest, without a model.** Each new or changed session and chat is reduced to a digest of only the messages added since the last run. The digest keeps what people wrote, plus each agent turn's reasoning (clipped to 2,000 characters per block) and its answers. Tool calls and tool output are left out, and so is injected project memory.
2. **Consolidate.** The digests are packed into batches of about 40,000 characters. A long conversation can be spread over several batches. Batches run one after another, each with a **fresh** worker session. The worker gets a copy of the current topics and edits, creates or deletes topic files in it, within the limits.
3. **Validate and replace.** The server checks the copy: file names, headers, at most 10 topics, size limits, no empty topics. It also checks that no conversation in the batch became private, was deleted or moved meanwhile. Only then does the copy replace the live topics and the index get regenerated. A failed batch changes nothing, and its conversations are retried on the next run. Messages appended during a run are picked up by the next one.

Workers use the project's **consolidation model** (Model settings → Project memory: a provider model, not a runtime), or the consolidating person's defaults when none is set. A small, cheap model is usually enough. Workers run on **pi durable** when it is available, so a worker turn interrupted by a restart resumes; otherwise on the default runtime. Worker conversations stay in the folder's durable SQLite file (pi durable cannot erase conversations); the app hides them.

Progress is live. The Project memory panel shows the batch in progress and lists each source (queued, part n/m, done, failed) with a Watch button that opens its worker. A session being consolidated shows a "memory n/m" chip in its header. A batch's worker is shared read-only only with the people who can see every conversation in that batch. Workers are removed when they finish.

## Context trimming

Long conversations, especially between people and agents, otherwise send their entire history on every model request. Each project has two settings under Model settings → Project memory → Agent context. Both apply to pi and pi durable sessions.

- **Trim turns after N hours** (default 12, 0 = never). A turn runs from a user message to the next one. Once a turn ended more than N hours ago, the model no longer sees its reasoning. Each tool call keeps its name, with arguments clipped to about 120 characters, and each result shrinks to its first line plus a note of what was cut (`… [trimmed: 48 lines, 3120 chars, 1 image]`). What people and the agent said stays.
- **Show last N hours** (default 168, 0 = all). Turns that ended before that are left out. A note on the first message the agent does see says how many messages are hidden and from when, and points to the `session_history` tool.

`session_history` searches the complete stored conversation (`query`) or reads it from a message number (`from`) or a time (`date`), 12,000 characters per page, with tool output up to 1,500 characters per result.

Only the copy sent with each request changes. The session file, durable SQLite, UI, memory extraction and archives keep everything. The turn in progress is never touched.

**Prompt cache.** The cutoffs are fixed when an agent starts working: on the first request of a runtime, or after an hour without requests (by then the provider's prompt cache has expired anyway). They do not move during active work, so the start of the prompt stays identical and cached. Settings changes take effect at the next such point.

**Project memory copies.** The topic index is put in front of the first prompt of every runtime and is stored with that message. Only the newest copy is sent. If it falls in the hidden window, it moves into the note.

Implementation: `server/extensions/lib/context-policy.mjs` is shared by the pi extension `server/extensions/context-policy.mjs` (pi's `context` event; it reads the project settings over `/api/context-bridge/:key`) and pi durable's `beforeRequest` generation hook in `server/src/harness/pi-durable.ts`. The pi extension loads before the Cloudflare assistance extension, so injection checks see the trimmed results.

## Privacy

Session sharing controls who can open the conversation. **Private session** is a separate explicit memory opt-out, available at creation or through the session menu. Default sessions contribute to common project memory even when the conversation itself is not shared. Private sessions never contribute; they can read common project memory. There is no private-memory consolidation.

Project memory is supplied only where the initiating user and all explicitly listed session viewers have project access. Memory files are project context, not a new filesystem security boundary: as elsewhere in this app, OS-level agent isolation is separate.

Making a source private during consolidation aborts publication. A source already consolidated cannot be made private retroactively through the toggle: its earlier public contributions may already have been read. Deliberate cleanup of previously published context requires reviewing the topics (and, from before topics, old snapshots). Avoid secrets in public sessions.

## Archive eligibility

A session is hidden from ordinary session lists only after successful consolidation, and only if:

- it is not explicitly private, deleted, a group-chat backing session or a memory worker;
- recorded prompt authorship identifies exactly its initiating owner (unknown or multiple authors are retained conservatively);
- it is idle and has no activity within the past 24 hours;
- it is not marked **Keep live**.

The session menu's Keep live option is independent of keeping an agent process running in the background. Project memory settings show an archive list with **Restore & keep live**, which restores the original session and prevents immediate rearchiving. Archived sessions cannot receive prompts until restored. Existing access checks still apply. The archive list contains only sessions the viewer can access.

## Replacement of legacy memory

`MEMORY_AFTER_DAYS` and the tenant-wide consolidation endpoint are removed. Legacy tenant memory workers are retired; their `MEMORY.md` indexes are renamed `MEMORY.legacy-<timestamp>.md` rather than imported into new public memory. Old detailed files are preserved, not deleted. New memory is rebuilt from eligible project sources.

## API

- `GET /api/memory/:projectId`: interval, consolidation model, context trimming, running status, batch n/m, per-source progress of the current or last run, topics (slug, title, description, updated, size), limits, whether a master from before topics is waiting, last successful run, latest error.
- `PATCH /api/memory/:projectId` with any of `{ "intervalHours": 0, "context": { "trimHours": 12, "windowHours": 168 }, "model": { "provider", "id", "thinkingLevel" } }`; `"model": null` returns to the consolidating person's defaults. Zero hours disables periodic runs.
- `GET|PUT|DELETE /api/memory/:projectId/topics/:slug`: read, create or replace (`{ "title", "description", "body" }`), delete a topic. Anyone with project access; 409 while a run is in progress or when an 11th topic would be created.
- `POST /api/memory/:projectId/consolidate`: manual run.
- `GET /api/memory-models`: the worker runtime and the provider models it offers.
- `GET /api/memory/:projectId/archives`: accessible archived sessions.
- `PATCH /api/sessions/:key/retention`: `memoryPrivate`, `keepLive`, or `archived: false` to restore.
- `POST /api/sessions` accepts `memoryPrivate` (default false).
- `POST /api/memory-bridge/:key` (session bridge credential): the pi extension's `project_memory` tool.
