// Loaded only by beezy's pi RPC adapter: project_memory reads the project's memory topics and
// project_memory_update changes them, over the session's bridge.
import { MEMORY_TOOL, MEMORY_UPDATE_TOOL } from "./lib/project-memory.mjs";

export default function (pi) {
  const url = process.env.BEEZY_MEMORY_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  const call = async (path, body, signal) => {
    const response = await fetch(url + path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
    });
    if (!response.ok && response.status !== 400) throw new Error(`project memory unavailable (${response.status})`);
    const { text } = await response.json();
    return { content: [{ type: "text", text }], details: {} };
  };
  pi.registerTool({ ...MEMORY_TOOL, execute: (_id, params, signal) => call("", { topics: params.topics, query: params.query }, signal) });
  pi.registerTool({ ...MEMORY_UPDATE_TOOL, execute: (_id, params, signal) => call("/update", params, signal) });
}
