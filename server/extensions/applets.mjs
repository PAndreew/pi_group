// Loaded only by beezy's pi RPC adapter. The server validates the same closed schema and keeps every
// applet (and every change to one) waiting until a person approves it; see docs/applets.md.
export default function (pi) {
  const url = process.env.BEEZY_APPLETS_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
  const id = { type: "string", pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,39}$", description: "Used as {{id}} in prompts." };
  const common = { id, label: text(120), help: { type: "string", maxLength: 500 }, optional: { type: "boolean", default: false, description: "May be left empty (fields are required by default)." } };
  const options = { type: "array", minItems: 1, maxItems: 100, items: text(100) };
  const field = (type, properties, required = ["id", "label"]) => ({ type: "object", additionalProperties: false, properties: { type: { const: type }, ...properties }, required: ["type", ...required] });
  const call = async (method, body, signal) => {
    const response = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`The applet was not saved: ${result.error ?? response.status}`);
    return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
  };

  pi.registerTool({
    name: "propose_applet",
    label: "Propose an applet",
    description: [
      "Save a small form (an \"applet\") the user can open any time at /apps/<slug> to run a task again without typing it out, e.g. a document translator with a file picker and a language dropdown.",
      "Use it when the user asks for an applet, app, form or button for a repeatable task. Fields come from a fixed set: markdown (help text), text, textarea, number, select (multiple: true for several), radio, checkbox, file (accept: [\".docx\"], multiple), folder.",
      "Each action is a button with a prompt template. Pressing it starts a new agent session in this folder with the filled-in prompt:",
      "- {{fieldId}} is the value; file and folder paths are relative to this folder, in backticks; lists are comma-separated; checkboxes are yes/no.",
      "- {{#fieldId}}…{{/fieldId}} is kept only when the field is set (checked, non-empty); {{^fieldId}}…{{/fieldId}} only when it is not.",
      "Write prompts that stand alone: the run has no memory of this conversation, so name the skill (\"/skill:name\" on its own line at the start, if one fits) and spell out where results go.",
      "Proposing an existing slug changes that applet; call list_applets first to start from its current spec. Every new applet or change waits until the user approves it on its page: tell them the URL.",
    ].join("\n"),
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        slug: { type: "string", pattern: "^[a-z0-9][a-z0-9-]{1,47}$", description: "Its URL: /apps/<slug>." },
        title: text(80),
        description: { type: "string", maxLength: 300, description: "One sentence for the applet list." },
        reason: { type: "string", maxLength: 1000, description: "For the person approving: what it does, or what changed." },
        fields: {
          type: "array", maxItems: 25,
          items: {
            anyOf: [
              field("markdown", { text: text(4000) }, ["text"]),
              field("text", { ...common, placeholder: { type: "string", maxLength: 200 }, default: { type: "string", maxLength: 2000 } }),
              field("textarea", { ...common, placeholder: { type: "string", maxLength: 200 }, default: { type: "string", maxLength: 20000 } }),
              field("number", { ...common, min: { type: "number" }, max: { type: "number" }, step: { type: "number" }, default: { type: "number" } }),
              field("select", { ...common, options, multiple: { type: "boolean", default: false }, default: { anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }] } }, ["id", "label", "options"]),
              field("radio", { ...common, options: { ...options, maxItems: 12 }, default: { type: "string" } }, ["id", "label", "options"]),
              field("checkbox", { id, label: text(120), help: { type: "string", maxLength: 500 }, default: { type: "boolean" } }),
              field("file", { ...common, accept: { type: "array", maxItems: 20, items: { type: "string", pattern: "^\\.[a-zA-Z0-9]{1,10}$" } }, multiple: { type: "boolean", default: false } }),
              field("folder", common),
            ],
          },
        },
        actions: {
          type: "array", minItems: 1, maxItems: 5,
          items: { type: "object", additionalProperties: false, properties: { id, label: text(60), prompt: text(20000) }, required: ["id", "label", "prompt"] },
        },
      },
      required: ["slug", "title", "fields", "actions"],
    },
    execute: (_toolCallId, params, signal) => call("POST", params, signal),
  });

  pi.registerTool({
    name: "list_applets",
    label: "List applets",
    description: "List the applets the user may change, with their current specs (a change waiting for approval is shown in place of the approved version). Use before changing one with propose_applet.",
    parameters: { type: "object", additionalProperties: false, properties: {} },
    execute: (_toolCallId, _params, signal) => call("GET", undefined, signal),
  });
}
