// Loaded only by beezy's pi RPC adapter. Agent threads, side threads and chat agents keep only the
// last hours of their conversation (24 by default) in the model's context. Older turns stay in the
// session file and in Beezy's archive, where the agent finds them with history_search and
// history_read (threads.mjs). The model also gets a short note about that, and what was said lately
// in the agentic chats its person is in. Other sessions are left untouched.

/**
 * The messages of the turns that reach back to `cutoff`, always including the last turn. A turn is a
 * user message and everything after it up to the next one, so a tool call is never separated from
 * its result.
 */
export function windowMessages(messages, cutoff) {
  const groups = [];
  for (const message of messages) {
    if (message.role === "user" || !groups.length) groups.push([]);
    groups.at(-1).push(message);
  }
  const time = (message) => (typeof message.timestamp === "number" && message.timestamp > 0 ? message.timestamp : Date.now());
  let start = groups.length - 1;
  while (start > 0 && groups[start - 1].some((message) => time(message) >= cutoff)) start--;
  return groups.slice(Math.max(start, 0)).flat();
}

/** Put Beezy's note in front of the first user message (a separate message would break turn order). */
export function withPreface(messages, preface) {
  if (!preface) return messages;
  const block = { type: "text", text: `[Beezy context]\n${preface}\n[/Beezy context]` };
  const index = messages.findIndex((message) => message.role === "user");
  if (index < 0) return [{ role: "user", content: [block], timestamp: messages[0]?.timestamp ?? Date.now() }, ...messages];
  const first = messages[index];
  const content = typeof first.content === "string" ? [block, { type: "text", text: first.content }] : [block, ...(first.content ?? [])];
  return [...messages.slice(0, index), { ...first, content }, ...messages.slice(index + 1)];
}

export default function (pi) {
  const url = process.env.BEEZY_THREADS_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  let settings;
  let loadedAt = 0;
  const load = async (signal) => {
    if (settings && Date.now() - loadedAt < 60_000) return settings;
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "context" }),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    });
    settings = response.ok ? await response.json() : { windowHours: null };
    loadedAt = Date.now();
    return settings;
  };

  pi.on("context", async (event, ctx) => {
    let current;
    try {
      current = await load(ctx?.signal);
    } catch {
      // Beezy unreachable: better the whole context than a wrong cut.
      return;
    }
    if (!current?.windowHours) return;
    const kept = windowMessages(event.messages, Date.now() - current.windowHours * 3_600_000);
    const dropped = event.messages.length - kept.length;
    const preface = [dropped > 0 ? current.note : "", current.digest].filter(Boolean).join("\n\n");
    if (!dropped && !preface) return;
    return { messages: withPreface(kept, preface) };
  });
}
