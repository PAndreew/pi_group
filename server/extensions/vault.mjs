// Loaded only by beezy's pi RPC adapter. Gives the agent the session owner's secrets, and those shared with the
// session's project, from beezy's vault, without the model ever seeing a value: it writes {{vault:KEY}} placeholders,
// which are filled into tool calls just before they run, and values in tool results are turned back into placeholders.
import { mapStrings, PLACEHOLDER, vaultIndex } from "./lib/vault-redact.mjs";

/** Tools whose arguments are never filled (their arguments may be stored or shared). */
const NO_FILL = new Set(["vault_list_secrets", "vault_get_secret", "project_memory_update", "request_user_input", "propose_scheduled_job", "propose_applet", "applet_data_write"]);

export default function (pi) {
  const url = process.env.BEEZY_VAULT_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  const call = async (path, signal) => {
    const response = await fetch(`${url}${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? `Vault error ${response.status}`);
    return result;
  };

  // Values, refreshed at most every 30 seconds so new or rotated secrets are picked up.
  let cached;
  const index = async () => {
    if (!cached || Date.now() - cached.at > 30000) {
      const { secrets } = await call("?values=1");
      cached = { at: Date.now(), index: vaultIndex(secrets) };
    }
    return cached.index;
  };

  pi.on("tool_call", async (event) => {
    if (NO_FILL.has(event.toolName) || !JSON.stringify(event.input ?? {}).match(PLACEHOLDER)) return;
    const vault = await index().catch(() => undefined);
    if (!vault) return { block: true, reason: "The secret vault is unavailable, so {{vault:…}} placeholders cannot be filled." };
    const missing = new Set();
    mapStrings(event.input, (text) => vault.fill(text, missing));
    if (missing.size) return { block: true, reason: `No vault secret for ${[...missing].join(", ")}. See vault_list_secrets.` };
  });

  pi.on("tool_result", async (event) => {
    const vault = await index().catch(() => undefined);
    if (!vault) return;
    const content = mapStrings(structuredClone(event.content ?? []), (text) => vault.redact(text));
    const details = event.details === undefined ? undefined : mapStrings(structuredClone(event.details), (text) => vault.redact(text));
    if (JSON.stringify(content) === JSON.stringify(event.content) && JSON.stringify(details) === JSON.stringify(event.details)) return;
    return { content, details };
  });

  pi.registerTool({
    name: "vault_list_secrets",
    label: "List vault secrets",
    description: [
      "List the secrets stored in beezy's vault for you: each key with a short description and whether it is the user's own (personal) or shared with this project, never the values.",
      "Use it when a task needs credentials (API tokens, passwords, connection strings) before asking the user for them.",
      "You never see values. Write {{vault:KEY}} (or {{vault:project:KEY}}) wherever a value belongs: in files you write or edit, in bash commands, in any tool argument. It is filled in just before the tool runs. Values in files and output are shown to you as the same placeholders, so edit them as they appear.",
    ].join("\n"),
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute(_toolCallId, _params, signal) {
      const { secrets } = await call("", signal);
      const text = secrets.length ? secrets.map((s) => `- ${s.key} (${s.scope})${s.description ? `: ${s.description}` : ""}`).join("\n") : "The vault is empty. Ask the user to add the secret under their profile menu → Secret vault, for themselves or for this project.";
      return { content: [{ type: "text", text }], details: { keys: secrets.map((s) => s.key) } };
    },
  });

  pi.registerTool({
    name: "vault_get_secret",
    label: "Use a vault secret",
    description: "Check that a secret exists and get the placeholder to use for it. Values are never shown: put {{vault:KEY}} in files, commands or other tool arguments and it is filled in when the tool runs.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        key: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$", description: "The secret's key." },
        scope: { type: "string", enum: ["personal", "project"], description: "Which vault to use when the key exists in both; optional." },
      },
      required: ["key"],
    },
    async execute(_toolCallId, params, signal) {
      const { key, scope } = await call(`/${encodeURIComponent(params.key)}${params.scope ? `?scope=${params.scope}` : ""}`, signal);
      const text = `Secret ${key} (${scope}) exists. Use {{vault:${params.scope ? `${params.scope}:` : ""}${key}}} wherever the value belongs, e.g. in a file you write or a bash command; it is filled in when the tool runs, and the value shows up as this placeholder in anything you read.`;
      return { content: [{ type: "text", text }], details: { key, scope } };
    },
  });
}
