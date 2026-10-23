# Roadmap

## Optional runtime assistance

The first, independent runtime integration is implemented for Pi RPC: per-user, off-by-default switches for Clef prompt-injection checks and Clairic tool-result extraction/tool discovery, with auxiliary usage accounting and spending guards. See [Cloudflare assistance](cloudflare-assistance.md) for setup and limitations. This does not implement the proactive pipeline below; pi-durable, multimodal support, a dedicated remote MCP catalogue broker and live accuracy/cost evaluation remain future work.

## Proactive, event-driven agent

Every new piece of data becomes an event: chat messages, uploads, finished agent runs, scheduled job output, and webhooks, mail or RSS. Each one gets a one-line `emit()` call where it already enters the app, and feeds a persistent SQLite queue. A pipeline on the Raspberry Pi then normalizes it (ffmpeg turns video into audio and keyframes), transcribes audio with Whisper (local whisper.cpp or Workers AI), and extracts metadata from text and images with Clairic. The results go into versioned SQLite items with a full-text index. Items only point to their source, and permissions are checked through the existing access functions at query time.

Clef triages each item: ignore, file, notify, suggest work, or start working. A per-project autonomy level set by people turns its probabilities into a push notification, a one-tap "Start on it?" card, or an autonomous run. Autonomous runs only happen for allow-listed kinds, and only produce drafts. The user's reactions are kept as examples, so triage improves. When a task starts, Clef also scores candidate items for relevance. The best ones go into the prompt as a short brief, and pi can fetch more with `search_items` / `open_item`.

Guards against prompt injection from incoming data: external content is fenced, sending, sharing and scripts still need approval, and runs per hour and the daily budget are capped. Items produced by agent runs never trigger new work, and every trigger→decision→action chain is visible. All model calls sit behind one interface with a "none" option, so without a provider the app behaves exactly as today.

Phases: (1) items, hooks and extraction for chats and uploads; (2) triage with notifications and suggestions; (3) context selection for prompts; (4) Whisper, video and images; (5) autonomy for allow-listed kinds.

## Later

- Project context across conversations: see [project-context.md](project-context.md).
- A credential vault: secrets used only by a broker after human approval, never seen by the agent.
- A path to Cloudflare (a sandbox and Durable Object per user, per-tenant storage) once the above proves useful on the Raspberry Pi.
