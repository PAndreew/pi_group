# Harness login in Beezy

Open **Avatar → Harness login** to connect provider accounts. You don't need access to the server terminal.

- **Pi Coding Agent:** Select a provider and save its API key. Keys are stored per Beezy user and provider in Pi's native profile. Choose a Pi model in **Model settings**. An admin-configured shared Pi fallback is separate from personal credentials.
- **Claude Code:** Select **Sign in to Claude Code**, follow the link to Claude, then paste the one-time code into Beezy. Create a private **Claude Code** session once connected. Each Beezy account has its own CLI profile and subscription login. Claude chat resumes in the original owner's profile and cannot be shared or transferred.

## Server setup

Install the official Claude Code CLI (v2.1.248 or newer) and set `BEEZY_CLAUDE_BINARY` to its absolute path in the Beezy server environment. Restart Beezy. The previous `BEEZY_CLAUDE_OWNER_ID` setting is no longer used. Historical sessions without an owner-bound CLI profile cannot be resumed.

The Claude adapter supports text, `Read`, `Glob`, `Grep`, and whatever thinking Claude exposes. It doesn't support shell access, editing, shared MCP, or steering. The CLI requires a Claude.ai Pro or Max login; check your plan rules and usage dashboard for subscription and extra-credit billing.

Beezy stores normalized transcripts under `DATA_DIR/claude-code` and native Claude profiles and history under `DATA_DIR/claude-accounts`. Deleting a Beezy session doesn't delete native history. Beezy separates credentials by account at the application layer; it does **not** sandbox Pi or the admin terminal into separate OS identities. Use a shared server only with trusted users.
