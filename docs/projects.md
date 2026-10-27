# Projects

A project is the unit that sessions and chats are grouped by, inside a tenant. Tenants stay the top level, e.g. Work and Family, each with its own projects. The bar under the header lists **General** first, then every other project, then **+**. The home screen and the chat list beside a conversation show only the active project's chats and sessions. Beezy remembers the active project per tenant.

- **General** belongs to every tenant and uses the tenant's chat folder. It can't be renamed or deleted.
- **Other projects** each get a new folder of their own when created, `projects/<name>` (numbered if that name is taken).
  - New sessions and chats started in the project work in this folder, or in a subfolder or linked folder picked with `#folder`.
  - **Everything uploaded in the project lands in `<project folder>/uploads`.** That includes composer attachments, the camera, and chat files, even for a session that works in a linked folder. The agent is given the path relative to its own working folder.
- **Linked folders:** you can link existing folders, such as a git repo, when creating the project or later from its "⋯" menu. Home offers linked folders first as starting points.
- **Membership:** an item with no explicit project belongs to the project whose own or linked folder contains its working folder most specifically, or to General if none does. Linking a folder therefore picks up the sessions already working in it. Items started inside a project, or moved into one, record that project explicitly.
- **Deleting a project** deletes no files and no conversations. Its folder stays on disk, and its items go back to the project that contains their folder, or to General. Only the project's creator can rename it, change its links, share it, or delete it.

## Explicit sharing (first implementation slice)

The project menu has **Share project with…**. The creator chooses existing members of the active tenant. Non-General projects appear only for their creator and explicitly selected members; tenant membership alone does not list them. Projects created before sharing existed have no `memberIds` and stay open to everyone in the tenant; the share dialog says so, and saving it limits the project to the creator and the selected people. New projects start creator-only. General remains tenant-wide for now.

Project membership never modifies session shares or chat membership. Earlier and future private sessions are not automatically shared. Sharing a conversation still uses the existing session sharing/forwarding controls. Revoking project membership does not revoke separately shared conversations.

**Human-facing file APIs and admin terminals are not yet project-isolated.** Administrators also retain existing session access. Do not rely on project membership to isolate untrusted collaborators. Agent tool execution now has the separate enforced boundary described below.

### Tools & connections

The project's menu exposes **Tools & connections**. Project creators (General: administrators) grant `off`, `read`, or `write` per capability. Each agent tool call rechecks the current grant; revocation blocks future calls, not already-running operations. Scheduled agent sessions inherit their project's grants.

- **Web search** is on (read) by default.
- **MCP servers** from the user-level `~/.pi/agent/mcp.json` each appear as a capability, **on by default**. Pi's built-in MCP support connects them with their existing command, environment and sign-in; credentials are never included in the project settings response. A server started with `--read-only` counts as read tools (also usable by the read-only butler); any other server counts as write tools. Project `.pi/mcp.json` files are never loaded, since agents can write project folders. MCP tools reach the model according to their [exposure](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/mcp.md#control-tool-exposure), through `codemode` or `tool_search` by default; codemode scripts run in QuickJS without Node, file or network access, and each tool they call passes the same gate.
- Operator-owned `DATA_DIR/tool-capabilities.json` registers further tools: exact Pi tool names, audited read/write classification, optional argument allowlists, an optional `defaultAccess`, and trusted extension adapters. An arbitrary host shell is not a capability adapter.

Beezy's own tools are always available: file and shell tools (sandboxed, below), the shared browser, vault, applets, scheduled-job proposals, `request_user_input`, Cloudflare assistance helpers, `codemode` and `tool_search`. Unknown tools are blocked.

### Agent execution and butler delegation

Pi RPC sessions load only explicit extensions: Beezy's (`project-scope.mjs` first, then `sandbox-tools.mjs` and the feature extensions) and Pi's built-in MCP, codemode and tool search. Discovered and project-local extensions and project trust are disabled; user-level skills, prompt templates and context files (`AGENTS.md`) load. Session storage is pinned server-side so project settings cannot redirect it. Prompt admission verifies the scope extension's readiness. Pi itself remains a trusted orchestrator on the host; Beezy's extensions act through authenticated server bridges.

- `sandbox-tools.mjs` replaces Pi's `read`, `write`, `edit` and `bash` (and user `!` commands) with the same tools whose every file and process operation runs on the server through `agent-bridge` in Linux Bubblewrap (`project-sandbox.ts`): explicit roots, read-only system binaries, a private process namespace, the host's TCP/UDP network (with read-only DNS/TLS configuration from `/etc`), temporary HOME/tmp, cleared environment and no unsandboxed fallback. Shell commands run up to 30 minutes by default (at most an hour) and keep the last 1 MB of output; files up to 25 MB can be read or written. Reading operator-installed skill files (`~/.pi/agent/skills`, `~/.agents/skills`) is the only host file access. Shell tools have no host model/bridge credentials. A seccomp filter allows only AF_INET/AF_INET6 sockets, so commands can use the internet but not Unix sockets (in mounted folders or abstract ones such as D-Bus), and denies io_uring, with an ABI guard. Commands can reach services listening on the host's TCP ports; background processes end with their command. x64 and arm64 Linux are supported. Bubblewrap is required; other harnesses are refused.
- `scope` reports the enforced mounts.
- Project sessions receive writable mounts for their own and linked folders only, even if the historical session cwd lies elsewhere. Server state, credentials and the running application's code cannot be mounted. Broad links overlapping those directories are rejected, not silently granted.
- A private General session owned by the invoking person, not attached to a group chat, is the butler. Its project mounts are read-only across all tenants where that person has explicit access. `butler_sessions` lists/reads conversations they own or have explicit session shares for; admin status is not a private-transcript bypass. General loose files and chat-only membership without session shares are not currently included.
- `delegate_project` is butler-only. The server rechecks target membership, switches tenant context, creates a **new private Pi session** in the target project, and submits the task as the invoking person. It returns a session key; the butler can poll progress with `butler_sessions`. Five delegations per run; delegated project agents cannot delegate again. Only the provided task text is forwarded, not the butler's transcript.
- Group General agents get a dedicated `General/groups/<chat-id>` folder, not the shared General/memory directory. Existing files are not automatically migrated. Shared standalone General sessions must be moved into a project or use a group chat before running an agent.
- Caller identity is server-side, reauthorized for each tool request. While a run is active, another person's prompt is rejected rather than replacing its authorization. Restart clears grants.

**Outside this boundary:** extensions and MCP servers themselves run on the host (operator-installed and trusted; an MCP server can do whatever its own implementation allows), as do human file APIs, admin terminals, scheduled scripts, trusted host Pi/configuration and kernel vulnerabilities are outside this boundary. This is not whole-tenant isolation from mutually untrusted host users.

Remaining work before the complete privacy model can be deployed:
- Extend the agent boundary to human file routes, folder search, terminals and scheduled scripts.
- Extend butler reads to General personal files and chat-only conversation membership without exposing another person's private transcripts.
- Tenant sharing now adds existing users without implicit project grants (see [tenants.md](tenants.md)); tenant ownership and removal remain to be built.
- Preserve private transcript isolation even from project agents; selected-turn sharing must publish only those turns.
- Resolve moved conversations whose working directories lie outside the destination project, and invitation/revocation for their participants.

## Moving

Swipe a row left to show **Move** next to **Delete**. For a chat with other people, Delete removes it for you: you leave the chat, and it is deleted once its last member deletes it. On desktop, use **Move to project…** in a session's menu, or the folder-arrow button in a chat's header.

- **A move keeps the item's working folder.** pi finds its transcripts by folder, and the paths in the conversation stay valid. A project can therefore include sessions working outside its own folder.
- **Who can move what:** a session can be moved by its owner or an admin, and a chat by any of its members.
- **When other people are in the item** (people the session is shared with, or the other chat members), the move waits until each of them approves. The requester sees a banner with **Cancel**. Each of the others gets a push notification and a banner with **Approve** / **Decline**. While it waits, the item shows "→ project". One decline cancels the move.
- **Moving a chat** also moves the pi session behind it.

## API

| Route | |
|---|---|
| `GET /api/projects` | Explicitly accessible projects, General first |
| `PUT /api/projects/:id/shares` `{memberIds}` | Creator replaces project membership; sessions unchanged |
| `POST /api/projects` `{name, links?}` | New project with a new folder of its own |
| `PATCH /api/projects/:id` `{name?, links?}` | Rename, or replace the linked folders |
| `DELETE /api/projects/:id` | Delete; items fall back as described above |
| `POST /api/projects/move` `{kind, id, to}` | Move now, or ask the others (`{moved: false, request}`) |
| `GET /api/projects/moves` | Moves waiting for the caller, and the caller's own pending moves |
| `POST /api/projects/moves/:id` `{approve}` | Approve or decline |
| `DELETE /api/projects/moves/:id` | The requester cancels |
| `GET /api/chats?project=<id>` | The chat list for one project |
| `DELETE /api/chats/:id` | Leave a chat; it is deleted once nobody is left |

`POST /api/sessions` and `POST /api/chats` take an optional `projectId`.

## Later

These were agreed in design and are not built yet:

- **Spaces:** a personal space per member and one per group, each with a storage quota. Group quotas are pooled from their pro members.
- **Per-project context:** instructions, extra mounts, and the history index from [project-context.md](project-context.md).
- **Runtimes on each pro user's microVM:** every run is billed to the person who invoked it.
- **Group runs and personal data:** a group run doesn't see the invoker's personal space unless they attach it.
