// Loaded only by beezy's pi RPC adapter: the archive of earlier conversation, and side threads for
// long tasks. Calls reach the server through the session's bridge credential; the server checks what
// the agent's person may read. See server/src/threads.ts.
export default function (pi) {
  const url = process.env.BEEZY_THREADS_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;

  const call = async (body, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? `Beezy request failed (${response.status})`);
    return result;
  };
  const text = (value) => ({ content: [{ type: "text", text: value }], details: undefined });
  const tool = (name, label, description, properties, required, run) =>
    pi.registerTool({ name, label, description, parameters: { type: "object", additionalProperties: false, properties, required }, execute: (_id, params, signal) => run(params, signal) });
  const when = { type: "string", maxLength: 40, description: "ISO date/time (e.g. 2026-10-01 or 2026-10-01T14:00) or milliseconds since 1970." };

  tool(
    "history_search",
    "Search earlier conversation",
    "Search the archive of earlier conversation: your agent thread, its side threads, and the agentic chats your person is in, including turns older than what you remember. Words match whole words; quote a phrase, end a word with * for a prefix. Without a query, returns the newest turns. Results show time, [conversation title · id] and sender; read around one with history_read.",
    {
      query: { type: "string", maxLength: 500 },
      conversation: { type: "string", maxLength: 300, description: "Limit to one conversation id, e.g. session:pi:abc or chat:123." },
      sender: { type: "string", maxLength: 100, description: "Part of a sender's name." },
      since: when,
      until: when,
      limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
    },
    [],
    async (params, signal) => text((await call({ action: "search", ...params }, signal)).results),
  );

  tool(
    "history_read",
    "Read earlier conversation",
    "Read a stretch of one archived conversation: around a moment (from a history_search result), or its latest turns.",
    {
      conversation: { type: "string", maxLength: 300, description: "Conversation id from history_search, e.g. session:pi:abc or chat:123." },
      around: when,
      before: { type: "integer", minimum: 0, maximum: 200, default: 20 },
      after: { type: "integer", minimum: 0, maximum: 200, default: 20 },
    },
    ["conversation"],
    async (params, signal) => text((await call({ action: "read", ...params }, signal)).turns),
  );

  tool(
    "start_side_thread",
    "Start a side thread",
    "From your agent thread only: hand a long task (more than a few minutes of work, e.g. a refactor, an investigation, a long test run) to a side thread that works on its own, so this thread stays free to talk. Its summary is posted back here when it finishes, fails or is stopped. Write the task so it stands on its own: goal, relevant files and constraints.",
    { task: { type: "string", minLength: 1, maxLength: 20000 }, name: { type: "string", maxLength: 120, description: "Short title; generated when omitted." } },
    ["task"],
    async (params, signal) => {
      const result = await call({ action: "side", ...params }, signal);
      return text(`Started side thread "${result.name}" (${result.sessionKey}). Its summary will be posted here when it ends.`);
    },
  );
}
