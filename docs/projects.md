# Projects

A project is the unit that sessions and chats are grouped by, inside a tenant. Tenants stay the top level, e.g. Work and Family, each with its own projects. The bar under the header lists **General** first, then every other project, then **+**. The home screen and the chat list beside a conversation show only the active project's chats and sessions. Beezy remembers the active project per tenant.

- **General** belongs to every tenant and uses the tenant's chat folder. It can't be renamed or deleted.
- **Other projects** each have a folder. New sessions and chats started in a project work in its folder, or in a subfolder picked with `#folder`. **+** creates a new folder, `projects/<name>`, unless you type or pick an existing one, such as a git repo.
- **Membership:** an item with no explicit project belongs to the project whose folder contains its working folder most specifically, or to General if none does. A project created from an existing folder therefore picks up the sessions already working in it. Items started inside a project, or moved into one, record that project explicitly.
- **Deleting a project** deletes no files and no conversations. Its items go back to the project that contains their folder, or to General. Only the project's creator or an admin can rename it, change its folder, or delete it.

## Moving

Swipe a row left to show **Move** (next to **Delete**). On desktop, use **Move to project…** in a session's menu, or the folder-arrow button in a chat's header.

- **A move keeps the item's working folder.** pi finds its transcripts by folder, and the paths in the conversation stay valid. A project can therefore include sessions working outside its own folder.
- **Who can move what:** a session can be moved by its owner or an admin, and a chat by any of its members.
- **When other people are in the item** (people the session is shared with, or the other chat members), the move waits until each of them approves. The requester sees a banner with **Cancel**. Each of the others gets a push notification and a banner with **Approve** / **Decline**. While it waits, the item shows "→ project". One decline cancels the move.
- **Moving a chat** also moves the pi session behind it.

## API

| Route | |
|---|---|
| `GET /api/projects` | The tenant's projects, General first |
| `POST /api/projects` `{name, folder, create?}` | New project; `create` makes the folder |
| `PATCH /api/projects/:id` `{name?, folder?}` | Rename, or change the folder |
| `DELETE /api/projects/:id` | Delete; items fall back as described above |
| `POST /api/projects/move` `{kind, id, to}` | Move now, or ask the others (`{moved: false, request}`) |
| `GET /api/projects/moves` | Moves waiting for the caller, and the caller's own pending moves |
| `POST /api/projects/moves/:id` `{approve}` | Approve or decline |
| `DELETE /api/projects/moves/:id` | The requester cancels |
| `GET /api/chats?project=<id>` | The chat list for one project |

`POST /api/sessions` and `POST /api/chats` take an optional `projectId`.

## Later

These were agreed in design and are not built yet:

- **Spaces:** a personal space per member and one per group, each with a storage quota. Group quotas are pooled from their pro members.
- **Per-project context:** instructions, extra mounts, and the history index from [project-context.md](project-context.md).
- **Runtimes on each pro user's microVM:** every run is billed to the person who invoked it.
- **Group runs and personal data:** a group run doesn't see the invoker's personal space unless they attach it.
