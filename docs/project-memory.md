# Project memory and session archives

Every non-General project already has a generated `projects/<name>/` folder under its tenant file root. General uses the tenant chat folder. Linked repositories do not become the memory storage location.

Model settings → Project memory configures the **selected project's** interval in hours. Zero disables automatic runs; manual runs remain available. Only the project creator or a tenant admin with project access can change the schedule or run consolidation. New projects default to off. Failed runs expose an error and can be retried. Automatic checks run every minute; missed schedules run after the server comes back.

## Three layers

- `MEMORY.md`: a master capped at 12,000 characters, containing durable terminology, architecture, confirmed decisions, constraints, conventions and brief current state. Its contents are supplied on the first prompt of each agent runtime, and again after changes. This also works for sessions started in linked repositories.
- `memory/<UTC timestamp>-<id>.md`: detailed snapshots with source session/chat IDs. Only new or changed sources are processed; long transcripts are chunked rather than tail-truncated. The worker writes staging files, which are validated before publication. Changed sources invalidate the run.
- `memory/archives/<id>.json.gz`: losslessly compressed session metadata and messages. Harness originals are retained as well; archiving is not deletion.

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

- `GET /api/memory/:projectId`: master, interval, running status, last successful run, latest error.
- `PATCH /api/memory/:projectId` with `{ "intervalHours": 0 }`: disable periodic runs (or set positive integer hours).
- `POST /api/memory/:projectId/consolidate`: manual run.
- `GET /api/memory/:projectId/archives`: accessible archived sessions.
- `PATCH /api/sessions/:key/retention`: `memoryPrivate`, `keepLive`, or `archived: false` to restore.
- `POST /api/sessions` accepts `memoryPrivate` (default false).
