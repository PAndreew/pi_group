// Loaded only by beezy's pi RPC adapter. Reads the session owner's secrets from beezy's vault: keys and
// descriptions are listed, a value is fetched only when the agent asks for it by key.
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

  pi.registerTool({
    name: "vault_list_secrets",
    label: "List vault secrets",
    description: [
      "List the secrets the user stored in beezy's vault for you: each key with a short description, never the values.",
      "Use it when a task needs credentials (API tokens, passwords, connection strings) before asking the user for them.",
    ].join("\n"),
    parameters: { type: "object", additionalProperties: false, properties: {} },
    async execute(_toolCallId, _params, signal) {
      const { secrets } = await call("", signal);
      const text = secrets.length ? secrets.map((s) => `- ${s.key}${s.description ? `: ${s.description}` : ""}`).join("\n") : "The vault is empty. Ask the user to add the secret under their profile menu → Secret vault.";
      return { content: [{ type: "text", text }], details: { keys: secrets.map((s) => s.key) } };
    },
  });

  pi.registerTool({
    name: "vault_get_secret",
    label: "Read a vault secret",
    description: [
      "Read the value of one secret from beezy's vault by its exact key (see vault_list_secrets).",
      "Use the value only for the task at hand, e.g. pass it to a command through an environment variable. Never repeat it in your replies, write it into files or commit it.",
    ].join("\n"),
    parameters: {
      type: "object", additionalProperties: false,
      properties: { key: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$", description: "The secret's key." } },
      required: ["key"],
    },
    async execute(_toolCallId, params, signal) {
      const { key, value } = await call(`/${encodeURIComponent(params.key)}`, signal);
      return { content: [{ type: "text", text: value }], details: { key } };
    },
  });
}
