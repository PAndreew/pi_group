// Loaded only by beezy's pi RPC adapter: project_memory reads the project's memory topics over the session's bridge.
import { MEMORY_TOOL } from "./lib/project-memory.mjs";

export default function (pi) {
  const url = process.env.BEEZY_MEMORY_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  pi.registerTool({
    ...MEMORY_TOOL,
    async execute(_id, params, signal) {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ topics: params.topics, query: params.query }),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(`project memory unavailable (${response.status})`);
      const { text } = await response.json();
      return { content: [{ type: "text", text }], details: {} };
    },
  });
}
