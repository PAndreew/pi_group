# Agent buttons, beezy docs and the command palette

Beezy's agents know which parts of the app exist. They can point people to them with buttons, read Beezy's own documentation and API list, and the same list of parts powers a command palette (Ctrl/⌘+K).

## Surfaces

A *surface* is a part of the app a button or the palette opens:

| id | Opens | Prefill params |
|---|---|---|
| `remote-machines` | Remote machines | `host` (`user@host:port` is split up), `name` |
| `scheduled-jobs` | Scheduled jobs | |
| `applets` | Applets | |
| `vault` | Secret vault, add form | `key`, `description` |
| `model-settings` | Model settings | |
| `tools` | Tools of the current session | |
| `resource-monitor` | Resource monitor | |
| `files` | Folders and files | `folder` |
| `links` | Links | |
| `new-session` | A new session | `folder`, `browser` (true: with the shared browser) |
| `terminal` | Terminal (admins only) | |
| `users` | Manage users (admins only) | |

The list lives twice and a test keeps the copies in step (`web/test/surfaces.test.mjs`):
- `server/extensions/lib/app-guide.mjs`: for agents, with when to suggest each one.
- `web/src/lib/surfaces.ts`: for the web app, with labels and palette keywords.

Add a surface to both lists, add its dialog to `web/src/components/surface-dialogs.tsx` (or a special case in `App.tsx` `surfaces.open`), and give it an icon in `surface-actions.tsx`.

## Buttons in messages

An agent writes a fenced block:

````
```beezy-action
{"open": "vault", "label": "Add the weather API key", "params": {"key": "WEATHER_API_KEY"}}
```
````

A JSON array holds up to 3 buttons. `markdown.tsx` renders the block as buttons (`SurfaceActionBlock`) in sessions and group chats alike. The rules:
- Unknown ids are dropped.
- Admin-only surfaces are hidden from people who aren't admins.
- Outside the workspace the block renders nothing.
- Buttons only open a surface and prefill its form. Saving is always the person's own step.

## What agents are told
- The pi RPC extension `server/extensions/app-guide.mjs` adds the list and the button syntax to the system prompt. The pi-durable adapter adds the same text as its `beezy` section.
- Agents are told to offer one or two buttons at most, only when they help with the task at hand, and never again after the person declined.
- If an agent can make the thing itself (a scheduled job, an applet), it proposes it with its tool first.
- For secrets, agents send people to the vault rather than asking for a value in the chat.

## beezy_docs
The `beezy_docs` tool (both harnesses) reads `docs/*.md`:
- Without arguments it lists the topics.
- `topic` reads one topic.
- `query` greps all topics.
- Topic `api` lists the HTTP endpoints. The list is read from the `router.get/post/…` calls in `server/src/*.ts`, so it never goes stale; internal `*-bridge` routes are left out and admin-only routes are marked. Agents can't call the API: it needs a signed-in browser cookie.

## Command palette
Ctrl/⌘+K (except inside a terminal) or the search icon in the header opens `web/src/components/command-palette.tsx`. It lists:
- **Chats and sessions:** the 5 most recent of the active project, or up to 8 matches while typing.
- **Go to:** every surface this person may open.
- **Actions:** search messages in chats, switch theme, change password.
- **Applets:** approved applets that match what was typed.

Every word typed must match. Arrow keys (or Ctrl+N/P) move the selection, Enter opens it.

The sidebar menu (`composer-tools.tsx`) opens surfaces the same way. All their modals are rendered once, in `SurfaceDialogs` in `App.tsx`. Opening a surface closes the mobile drawer.
