// Loaded only by beezy's pi RPC adapter: tells the agent which parts of beezy it can point people to
// (```beezy-action buttons) and gives it beezy_docs to read beezy's documentation and API list.
import { appGuide, DOCS_TOOL, docsAnswer } from "./lib/app-guide.mjs";

export default function (pi) {
  const guide = appGuide();
  pi.on("before_agent_start", async (event) => ({ systemPrompt: event.systemPrompt + guide }));
  pi.registerTool({
    ...DOCS_TOOL,
    async execute(_id, params) {
      return { content: [{ type: "text", text: docsAnswer(params) }], details: {} };
    },
  });
}
