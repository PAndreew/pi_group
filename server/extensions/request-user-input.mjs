// Loaded only by beezy's pi RPC adapter. The server validates the same closed schema.
export default function (pi) {
  const base = process.env.BEEZY_INTERACTION_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!base || !token) return;
  const text = { type: "string", minLength: 1 };
  pi.registerTool({
    name: "request_user_input",
    label: "Ask the user",
    description: "Ask the user to choose one or several options in beezy. Waits for their answer; cancellation is an explicit result. Use stable option IDs. This is not authorization to perform destructive actions.",
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        type: { type: "string", enum: ["single_choice", "multi_choice"] },
        title: { ...text, maxLength: 300 },
        description: { type: "string", maxLength: 2000 },
        options: { type: "array", minItems: 1, maxItems: 30, items: { type: "object", additionalProperties: false, properties: { id: { ...text, maxLength: 100 }, label: { ...text, maxLength: 300 }, description: { type: "string", maxLength: 1000 } }, required: ["id", "label"] } },
        submitLabel: { ...text, maxLength: 60 },
      },
      required: ["type", "title", "options"],
    },
    async execute(toolCallId, params, signal) {
      const request = async (url, method, body, abort = signal) => {
        const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body), signal: abort ? AbortSignal.any([abort, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
        if (!response.ok) throw new Error(`User interaction failed (${response.status})`);
        return response.json();
      };
      let card;
      try {
        card = await request(base, "POST", { toolCallId, spec: { ...params, version: 1 } });
        while (card.status === "pending") {
          await new Promise((resolve, reject) => {
            if (signal?.aborted) return reject(signal.reason ?? new Error("Aborted"));
            const onAbort = () => { clearTimeout(timer); reject(signal.reason ?? new Error("Aborted")); };
            const timer = setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, 1000);
            signal?.addEventListener("abort", onAbort, { once: true });
          });
          card = await request(`${base}/${card.id}`, "GET");
        }
        const answer = { status: card.status, selected: card.selected ?? [], respondent: card.respondent, interactionId: card.id };
        return { content: [{ type: "text", text: JSON.stringify(answer) }], details: answer };
      } finally {
        if (card?.status === "pending") await request(`${base}/${card.id}`, "DELETE", undefined, null).catch(() => {});
      }
    },
  });
}
