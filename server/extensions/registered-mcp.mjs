// Trusted adapter for the existing read-only Workspace MCP. The project-scope
// extension authorizes every exposed tool call. Never expose MCP protocol methods.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import path from "node:path";

const approved = new Set(["search_drive_files", "get_drive_file_content", "get_drive_file_download_url", "get_drive_shareable_link"]);
export default async function (pi) {
  const file = process.env.BEEZY_MCP_CONFIG;
  if (!file) throw new Error("Missing existing MCP configuration path");
  const config = JSON.parse(readFileSync(file, "utf8")).mcpServers?.["google-workspace"];
  if (!config || config.enabled === false || path.basename(config.command ?? "") !== "workspace-mcp" || !config.args?.includes("--read-only")) throw new Error("Workspace MCP must remain enabled and read-only");
  const expand = value => String(value).replace(/\$\{([^}]+)\}/g, (_all, name) => process.env[name] ?? "");
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, LANG: process.env.LANG, ...Object.fromEntries(Object.entries(config.env ?? {}).map(([key, value]) => [key, expand(value)])) };
  let child;
  let reader;
  let sequence = 0;
  let ready;
  const pending = new Map();
  const close = () => {
    for (const { reject, timer } of pending.values()) { clearTimeout(timer); reject(new Error("Workspace MCP connection closed")); }
    pending.clear();
    reader?.close();
    const running = child;
    child = undefined;
    ready = undefined;
    if (running && running.exitCode === null) {
      running.kill("SIGTERM");
      const timer = setTimeout(() => { if (running.exitCode === null) running.kill("SIGKILL"); }, 2000);
      timer.unref();
    }
  };
  const request = (method, params, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("MCP call cancelled"));
    const id = ++sequence;
    const abort = () => {
      const entry = pending.get(id);
      if (!entry) return;
      pending.delete(id);
      clearTimeout(entry.timer);
      reject(new Error("MCP call cancelled"));
      child?.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/cancelled", params: { requestId: id, reason: "Cancelled" } }) + "\n");
    };
    const timer = setTimeout(() => { pending.delete(id); signal?.removeEventListener("abort", abort); reject(new Error("Workspace MCP timed out")); }, 60000);
    pending.set(id, {
      timer,
      resolve: value => { signal?.removeEventListener("abort", abort); resolve(value); },
      reject: error => { signal?.removeEventListener("abort", abort); reject(error); },
    });
    signal?.addEventListener("abort", abort, { once: true });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const connect = () => ready ??= (async () => {
    child = spawn(config.command, config.args ?? [], { env, cwd: config.cwd ? expand(config.cwd) : process.env.HOME, stdio: ["pipe", "pipe", "ignore"] });
    const current = child;
    const closeCurrent = () => { if (child === current) close(); };
    child.on("error", closeCurrent);
    child.on("exit", closeCurrent);
    child.stdin.on("error", closeCurrent);
    reader = createInterface({ input: child.stdout });
    reader.on("line", line => {
      if (line.length > 5_000_000) { close(); return; }
      let message;
      try { message = JSON.parse(line); } catch { return; }
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error("Workspace MCP rejected the operation"));
      else entry.resolve(message.result);
    });
    await request("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "beezy-project-tools", version: "1" } });
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
  })().catch(error => { close(); throw error; });
  try {
    await connect();
    const result = await request("tools/list", {});
    for (const tool of result.tools ?? []) {
      if (!approved.has(tool.name)) continue;
      pi.registerTool({
        name: `mcp__google_workspace__${tool.name}`, label: `Drive: ${tool.name}`, description: tool.description || tool.name,
        parameters: tool.inputSchema,
        async execute(_id, input, signal) {
          await connect();
          const result = await request("tools/call", { name: tool.name, arguments: input }, signal);
          const text = JSON.stringify(result);
          return { content: [{ type: "text", text: text.slice(0, 100000) + (text.length > 100000 ? "\n[truncated]" : "") }], isError: Boolean(result.isError), details: undefined };
        },
      });
    }
  } finally { close(); } // discovery must not keep a subprocess alive in non-session invocations
  pi.on("session_shutdown", close);
}
