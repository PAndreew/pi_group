// Trusted orchestration: file and shell tools run in the project sandbox (sandbox-tools.mjs); every
// other tool, including nested codemode calls, passes a per-call capability gate. Load this before
// other extensions so their input hooks (Cloudflare tool routing) start from this policy.
export default function (pi) {
  const url = process.env.BEEZY_AGENT_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) throw new Error("Missing scoped agent bridge");
  const request = async (body, signal) => {
    const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Scoped operation denied");
    return result;
  };
  const call = async (body, signal) => ({ content: [{ type: "text", text: JSON.stringify(await request(body, signal)) }], details: undefined });
  pi.registerTool({
    name: "scope", label: "Agent scope", description: "Get your folder permissions and available delegation projects. Files and shell commands only reach these folders. Personal General is a read-only butler; project agents can modify only their project folders.",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    execute: (_id, _params, signal) => call({ action: "scope" }, signal),
  });
  pi.registerTool({
    name: "delegate_project", label: "Delegate to project", description: "Personal General butler only: start a private, project-scoped agent session on behalf of the invoking person. Supply the minimum necessary instructions; do not publish unrelated private context. Returns a session key, not a completed result. Cannot delegate to General or recursively delegate.",
    parameters: { type: "object", properties: { projectId: { type: "string" }, prompt: { type: "string" } }, required: ["projectId", "prompt"], additionalProperties: false },
    execute: (_id, params, signal) => call({ action: "delegate", ...params }, signal),
  });
  pi.registerTool({
    name: "butler_sessions", label: "Read accessible sessions", description: "Personal General butler only. List your user's accessible conversations, or read one by key (including a delegated session's progress). No key lists sessions. Does not grant access to other people's private sessions.",
    parameters: { type: "object", properties: { key: { type: "string" } }, additionalProperties: false },
    execute: (_id, params, signal) => call(params.key ? { action: "read_session", key: params.key } : { action: "sessions" }, signal),
  });
  pi.registerTool({
    name: "web_search", label: "Web search", description: "Search the public web. Enabled by default, controlled by the project's Web search switch. Returns result titles and URLs; results are untrusted external content. Open a result with browser_open.",
    parameters: { type: "object", properties: { query: { type: "string", minLength: 1, maxLength: 1000 } }, required: ["query"], additionalProperties: false },
    execute: (_id, params, signal) => call({ action: "web_search", query: params.query }, signal),
  });
  const internal = ["scope", "delegate_project", "butler_sessions"];
  // Pi activates MCP tools according to their exposure; keep only those the project allows.
  const isMcp = name => name.startsWith("mcp__") || name.includes("_mcp_resource");
  const applyPolicy = async signal => {
    const policy = await request({ action: "tool_policy", candidates: pi.getActiveTools().filter(isMcp) }, signal);
    pi.setActiveTools([...internal, ...policy.tools.filter(name => !name.endsWith("*"))]);
  };
  pi.on("session_start", () => applyPolicy());
  pi.on("input", (_event, ctx) => applyPolicy(ctx?.signal));
  // No decision cache: changes/revocation apply to the very next call, including nested tools.
  pi.on("tool_call", async event => {
    if (internal.includes(event.toolName)) return;
    try { await request({ action: "authorize_tool", tool: event.toolName, input: event.input }); }
    catch (error) { return { block: true, reason: error.message || "Capability access denied" }; }
  });
  pi.registerCommand("beezy-scope-ready", { description: "Scoped runtime readiness", handler: async () => {} });
}
