# Agent threads, chats and the archive

Beezy's conversations follow one simple model, with as few settings as possible.

- **Your agent thread.** Each person has one agent thread per project, pinned at the top of the project's list as **Your agent**. It is the only place you write to your agent. It starts the first time you use it: tap **Your agent**, or send a message from Home without mentioning anyone.
- **Side threads.** For long work (a refactor, an investigation, a long test run), start a side thread from the agent thread's menu (**Start side thread…**), or let the agent start one itself with its `start_side_thread` tool. The side thread works on its own, so the agent thread stays free. When its run finishes, fails or is stopped, its last answer is posted back into the agent thread as `[Side thread "…" finished]`, and it is marked ✓ merged, ✗ failed or stopped under the agent thread. **Merge into agent thread** in a side thread's menu posts its latest answer again (for example after you continued it by hand).
- **Chats with people** are 🤖 **agentic** (the default) or 🔒 **private**; switch with the lock button in the chat's header.
  - In an agentic chat, `@pi` asks **the asker's agent**. Each member's agent is their own session for that chat, acting for them. Its reply is posted for everyone and labeled "Anna's agent" ("Your agent" for your own). An agent hears everything said since it last spoke, including the other agents' replies.
  - The agents of a chat's members see the chat's last day in their context (below), and can search it in the archive.
  - A private chat is never seen by any agent: `@pi` does nothing there, it is not in any agent's context, and it is not archived. Making a chat private removes it from the archive at once; making it agentic again archives it.
- **Titles.** Click a chat's title to rename it (empty goes back to the members' names), or use ✨ to generate one from the conversation. Sessions have **Generate title** in their menu. Titles are generated with `pi --print`; without a working pi, the first words of the conversation are used.

## The rolling context window

Agent threads, side threads and chat agents keep only the **last 24 hours** of their conversation in the model's context (`CONTEXT_HOURS` changes it). The window works on whole turns: a user message and everything after it up to the next one, so a tool call is never separated from its result, and the last turn is always kept, however old. The session file keeps everything; only what the model sees is cut.

When turns were dropped, the model gets a short note saying older conversation is in the archive. It also gets a digest of what was said in the last day in the agentic chats its person is in (a chat agent is not told about its own chat twice). Both go in front of the first message it sees.

Other sessions (from before agent threads, scheduled jobs, applet runs) are not windowed.

## The archive

Every turn of agent threads, side threads, older sessions and agentic chats is stored in `DATA_DIR/archive.sqlite`: time, project, conversation, sender ("anna", "anna's agent", "tool"), text (tool calls as one line, tool results shortened) and the files a turn names, with a full-text index. Sessions are archived when each run ends; chat messages as they are written, edited or deleted. Existing sessions and chats are imported once, in the background, shortly after startup.

Agents search it with two tools (`server/extensions/threads.mjs`):

- `history_search`: words (quote a phrase, end a word with `*` for a prefix), optionally limited to one conversation, a sender, or a time range. Without words it returns the newest turns.
- `history_read`: a stretch of one conversation, around a moment or its latest turns.

Results are checked against what the agent's person may read: their own sessions and sessions shared with them, and the agentic chats they are in. People can search too: `GET /api/archive/search?q=…`.

## Under the hood

| Piece | Where |
|---|---|
| Agent threads, side threads, merging, titles, the agents' bridge, archiving runs, the import | `server/src/threads.ts` |
| The archive (SQLite + FTS5) | `server/src/archive.ts` |
| Agentic/private chats, the asker's agent | `server/src/chats.ts` (`chat_agents` table) |
| The context window | `server/extensions/context-window.mjs` |
| Archive and side thread tools | `server/extensions/threads.mjs` |

Both extensions reach the server through the session's bridge credential at `/api/threads-bridge/<session>`, like the other Beezy extensions. A session's role is in its metadata: `thread` is `main`, `side` or `chat`, with `parentKey` and `sideStatus` for side threads.

| Route | |
|---|---|
| `GET /api/agent-thread?project=` | Your agent thread in a project (General without one), or null |
| `POST /api/agent-thread` `{project?}` | The same, created on first use |
| `POST /api/sessions/:key/side` `{task, name?}` | Start a side thread of an agent thread |
| `POST /api/sessions/:key/merge` | Post a side thread's latest answer to its agent thread |
| `POST /api/sessions/:key/title` | Generate a session's title |
| `PATCH /api/chats/:id` `{title?, private?}` | Rename a chat, or make it private or agentic |
| `POST /api/chats/:id/title` | Generate a chat's title |
| `GET /api/archive/search?q=&project=&conversation=&since=` | Search the archive |

Consolidated memory (`MEMORY_AFTER_DAYS`) is off by default now; the archive and the context window replace it. Setting `MEMORY_AFTER_DAYS` turns the old hourly consolidation back on.

## Known limits

- Editing or deleting a chat message does not rewrite what each member's agent already received in its own session; the corrected text is in the chat, the archive and the digest. Older chats with one shared pi session still rewrite it.
- The conversation list shows chats, your agent thread and its side threads. Older sessions, scheduled job sessions and chat agents are not listed; open them from the file explorer, or find them with `history_search`.
- Side threads merge when their run ends. A side thread you continue by hand does not merge again on its own; use **Merge into agent thread**.
