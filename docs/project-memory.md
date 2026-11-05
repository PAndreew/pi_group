# Project memory and session archives

Every non-General project already has a generated `projects/<name>/` folder under its tenant file root. General uses the tenant chat folder. Linked repositories do not become the memory storage location.

Model settings → Project memory configures the **selected project's** interval in hours. Zero disables automatic runs; manual runs remain available. Only the project creator or a tenant admin with project access can change the schedule or run consolidation. New projects default to off. Failed runs expose an error and can be retried. Automatic checks run every minute; missed schedules run after the server comes back.

## Three layers

- `MEMORY.md`: a master capped at 12,000 characters, containing durable terminology, architecture, confirmed decisions, constraints, conventions and brief current state. Its contents are supplied on the first prompt of each agent runtime, and again after changes. This also works for sessions started in linked repositories.
- `memory/<UTC timestamp>-<source>.md`: one detailed snapshot per source and run, with the source ID and the message range it covers.
- `memory/archives/<id>.json.gz`: losslessly compressed session metadata and messages. Harness originals are retained as well; archiving is not deletion.

`memory/manifest.json` records how many messages of each source have been extracted and which snapshots still wait to be merged.

## How a run works

1. **Extract (map).** Every new or changed session and chat is extracted on its own, several at once ("Conversations at once", default 3, max 8). Only messages added since the last extraction are read, as a compact transcript: what people and the agent said and which tools were called, with tool output cut to a glimpse. A long transcript is split into parts of about 24,000 characters; each part gets a **fresh** worker session that updates the source's draft notes, so no worker's context fills up.
2. **Publish per source.** As soon as a source's notes are complete they are published as a timestamped snapshot and the source is marked consolidated. A failure loses only the sources still in flight; they are retried on the next run. Messages appended while a source was being extracted do not invalidate it; they are picked up next time. A source that becomes private, is deleted or moves to another project is not published.
3. **Merge (reduce).** The new snapshots are folded into `MEMORY.md` in batches of about 40,000 characters, each by a fresh worker reading the snapshot files. Each batch is validated (nonempty, at most 12,000 characters) before it replaces the master. Snapshots that could not be merged stay listed in the manifest and are merged on the next run.

Workers run on the project's **consolidation model** (Model settings → Project memory), or on the consolidating person's defaults when none is set. A small, cheap model is usually enough.

Progress is live: the Project memory panel lists each source (queued, part n/m, done, failed) with a Watch button that opens its worker. A session being extracted shows a "memory n/m" chip in its header; worker sessions are shared read-only with the source's viewers so they can watch them stream. Workers are removed when they finish.

## Privacy

Session sharing controls who can open the conversation. **Private session** is a separate explicit memory opt-out, available at creation or through the session menu. Default sessions contribute to common project memory even when the conversation itself is not shared. Private sessions never contribute; they can read common project memory. There is no private-memory consolidation.

Project memory is supplied only where the initiating user and all explicitly listed session viewers have project access. Memory files are project context, not a new filesystem security boundary: as elsewhere in this app, OS-level agent isolation is separate.

Making a source private during consolidation aborts publication. A source already consolidated cannot be made private retroactively through the toggle: its earlier public contributions may already have been read. Deliberate cleanup of previously published context requires reviewing the master and snapshots. Avoid secrets in public sessions.

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

- `GET /api/memory/:projectId`: master, interval, consolidation model, concurrency, running status and phase, per-source progress of the current or last run, last successful run, latest error.
- `PATCH /api/memory/:projectId` with any of `{ "intervalHours": 0, "concurrency": 3, "model": { "harness", "provider", "id", "thinkingLevel" } }`; `"model": null` returns to the consolidating person's defaults. Zero hours disables periodic runs.
- `POST /api/memory/:projectId/consolidate`: manual run.
- `GET /api/memory/:projectId/archives`: accessible archived sessions.
- `PATCH /api/sessions/:key/retention`: `memoryPrivate`, `keepLive`, or `archived: false` to restore.
- `POST /api/sessions` accepts `memoryPrivate` (default false).
