// Loaded only by beezy's pi RPC adapter. The session's shared browser: the people in the chat watch the
// same page live and can pick elements on it to reference them. See docs/browser.md.
const guidance = `

## Shared browser in beezy
This session has a headless browser the people in the chat see live in beezy's browser panel (the globe icon). Use the browser_* tools to open, read and drive it.
To show a web app, start its dev server in the background so it keeps running (e.g. \`nohup npm run dev > dev.log 2>&1 &\`), wait until it listens, then browser_open its http://localhost:<port> URL and tell the user it is open in the browser panel.
People can pick elements in the panel; their message then lists "Referenced page elements" with a CSS selector, text, HTML, a screenshot and, when the app provides it, the source file and component. The selectors work with browser_click and browser_type. Use the source location to find the code.`

export default function (pi) {
  const url = process.env.BEEZY_BROWSER_URL;
  const token = process.env.BEEZY_INTERACTION_TOKEN;
  if (!url || !token) return;
  pi.on("before_agent_start", async (event) => ({ systemPrompt: event.systemPrompt + guidance }));

  const call = async (body, signal) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(45000)]) : AbortSignal.timeout(45000),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? `Browser request failed (${response.status})`);
    return result;
  };
  const page = (result) => `${result.title || "(untitled)"} — ${result.url}`;
  const selector = { type: "string", minLength: 1, maxLength: 2000, description: "A CSS selector, or a Playwright selector such as text=Save or role=button[name=\"Save\"]." };
  const tool = (name, label, description, properties, required, run) =>
    pi.registerTool({
      name,
      label,
      description,
      parameters: { type: "object", additionalProperties: false, properties, required },
      async execute(_toolCallId, params, signal) {
        return run(params, signal);
      },
    });

  tool("browser_open", "Open a page in the shared browser", "Open a URL in the session's shared browser (starting it if needed). The people in the chat see it live.", { url: { type: "string", minLength: 1, maxLength: 4000 } }, ["url"], async (params, signal) => {
    const result = await call({ action: "open", url: params.url }, signal);
    return { content: [{ type: "text", text: `Opened ${page(result)}` }], details: result };
  });
  tool("browser_snapshot", "Read the page", "The accessibility tree of the page in the shared browser: its text, roles and names, to understand it or find elements to click.", {}, [], async (_params, signal) => {
    const result = await call({ action: "snapshot" }, signal);
    return { content: [{ type: "text", text: `${page(result)}\n\n${result.snapshot}` }], details: { url: result.url, title: result.title } };
  });
  tool("browser_screenshot", "Look at the page", "A screenshot of what the shared browser shows right now.", {}, [], async (_params, signal) => {
    const result = await call({ action: "screenshot" }, signal);
    return { content: [{ type: "text", text: page(result) }, { type: "image", data: result.image, mimeType: "image/jpeg" }], details: { url: result.url, title: result.title } };
  });
  tool("browser_click", "Click in the page", "Click an element in the shared browser.", { selector }, ["selector"], async (params, signal) => {
    const result = await call({ action: "click", selector: params.selector }, signal);
    return { content: [{ type: "text", text: `Clicked. Now at ${page(result)}` }], details: result };
  });
  tool("browser_type", "Type into the page", "Fill a text field in the shared browser, optionally pressing Enter afterwards.", { selector, text: { type: "string", maxLength: 10000 }, submit: { type: "boolean", default: false } }, ["selector", "text"], async (params, signal) => {
    const result = await call({ action: "type", selector: params.selector, text: params.text, submit: params.submit }, signal);
    return { content: [{ type: "text", text: `Typed. Now at ${page(result)}` }], details: result };
  });
  tool("browser_close", "Close the browser", "Close the session's shared browser for everyone.", {}, [], async (_params, signal) => {
    await call({ action: "close" }, signal);
    return { content: [{ type: "text", text: "Browser closed." }], details: {} };
  });
}
