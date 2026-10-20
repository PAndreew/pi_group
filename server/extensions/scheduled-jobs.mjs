// Loaded only by beezy's pi RPC adapter. The server validates the same schema and keeps every proposal
// paused until a person approves it; see docs/scheduled-jobs.md.
export default function (pi) {
  const url = process.env.BEEZY_JOBS_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  const text = (maxLength) => ({ type: "string", minLength: 1, maxLength });
  const timeoutSec = (maximum, def) => ({ type: "integer", minimum: 1, maximum, default: def, description: `Seconds before the step is stopped (default ${def}).` });
  pi.registerTool({
    name: "propose_scheduled_job",
    label: "Propose a scheduled job",
    description: [
      "Propose a job that beezy runs on a schedule, when the user asks for something recurring or for later.",
      "A job is 1-5 steps run in order; each step's output is handed to the next:",
      "- prompt: a message to an agent session. Use {{output}} where the previous step's output should go (otherwise it is appended).",
      "- script: a shell command run in this folder with a minimal environment; the previous output arrives on stdin. Needs an admin's approval.",
      "- http: one HTTP(S) request. Redirects are not followed; private-network addresses need an admin's approval.",
      "Combine them, e.g. an http step that fetches data, then a prompt that summarises it.",
      "Schedule: five-field cron in the server's local time (\"30 7 * * 1-5\"), @hourly, @daily, @weekly, @monthly or \"@every 2h\"; at most every 5 minutes.",
      "The job is saved paused: tell the user to review and approve it under Scheduled jobs (the clock icon). Never put passwords or tokens in a job unless the user explicitly gave them for this purpose.",
    ].join("\n"),
    parameters: {
      type: "object", additionalProperties: false,
      properties: {
        name: { ...text(120), description: "Short name shown in the list." },
        schedule: { ...text(100), description: "When it runs." },
        session: { type: "string", enum: ["new", "this"], default: "new", description: "Where prompt steps go: a dedicated new session (default), or this session." },
        recipients: { type: "array", maxItems: 20, items: text(120), description: "Exact Beezy account usernames to receive read access and run notifications. Ask if unknown; names in the prompt do not route delivery. Requires session=new and a prompt step. The owner also retains access. Recipients can see the entire dedicated session, including tool output." },
        reason: { type: "string", maxLength: 1000, description: "One or two sentences for the person approving: what it does and why." },
        steps: {
          type: "array", minItems: 1, maxItems: 5,
          items: {
            anyOf: [
              { type: "object", additionalProperties: false, properties: { type: { const: "prompt" }, text: text(20000) }, required: ["type", "text"] },
              { type: "object", additionalProperties: false, properties: { type: { const: "script" }, command: text(4000), timeoutSec: timeoutSec(600, 60) }, required: ["type", "command"] },
              {
                type: "object", additionalProperties: false,
                properties: {
                  type: { const: "http" },
                  method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"], default: "GET" },
                  url: { ...text(2000), description: "http:// or https:// URL." },
                  headers: { type: "object", additionalProperties: { type: "string", maxLength: 2000 } },
                  body: { type: "string", maxLength: 20000 },
                  timeoutSec: timeoutSec(120, 30),
                },
                required: ["type", "url"],
              },
            ],
          },
        },
      },
      required: ["name", "schedule", "steps"],
    },
    async execute(_toolCallId, params, signal) {
      const response = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(params),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(`The job was not saved: ${result.error ?? response.status}`);
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  });
}
