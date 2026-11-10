// Loaded only by beezy's pi RPC adapter: trims what the model sees of old turns (the session file keeps
// everything) and offers session_history to read it back. See docs/project-memory.md#context-trimming.
import { applyContextPolicy, epochTracker, historyPage, HISTORY_TOOL } from "./lib/context-policy.mjs";

export default function (pi) {
  const url = process.env.BEEZY_CONTEXT_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  const cutoffs = epochTracker(async () => {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`context policy unavailable (${response.status})`);
    return response.json();
  });
  pi.on("context", async (event) => {
    // Without the project's policy the request goes out untouched; the next request retries.
    const current = await cutoffs("session").catch(() => undefined);
    if (current) return { messages: applyContextPolicy(event.messages, current) };
  });
  pi.registerTool({
    ...HISTORY_TOOL,
    async execute(_id, params, _signal, _update, ctx) {
      const messages = ctx.sessionManager.getBranch().map(e => e.message).filter(Boolean);
      return { content: [{ type: "text", text: historyPage(messages, params) }], details: {} };
    },
  });
}
