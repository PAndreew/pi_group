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

Someone a conversation is shared with, but who is not a member of its project, finds it under their **General**; the project itself stays hidden from them.

**Project membership is an organizing and visibility boundary, not isolation.** Agents run with the server user's permissions and can reach files outside their project, as can human-facing file APIs and admin terminals. Administrators also retain existing session access. Do not rely on project membership to isolate untrusted collaborators.

Remaining work:
- Tenant sharing adds existing users without implicit project grants (see [tenants.md](tenants.md)); tenant ownership and removal remain to be built.
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
