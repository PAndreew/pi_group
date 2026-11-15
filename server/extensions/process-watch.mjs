// Loaded only by beezy's pi RPC adapter: process_watch arms, lists and cancels watches over the session's bridge.
import { WATCH_TOOL, watchInput } from "./lib/process-watch.mjs";

export default function (pi) {
  const url = process.env.BEEZY_WATCH_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  pi.registerTool({
    ...WATCH_TOOL,
    async execute(_id, params, signal) {
      // Arming connects over SSH and installs the helper, so it may take a while.
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(watchInput(params)),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(90000)]) : AbortSignal.timeout(90000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? `process_watch failed (${response.status})`);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}
