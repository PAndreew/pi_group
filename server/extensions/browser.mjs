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
  tool("browser_snapshot", "Read the page", "The accessibility tree of the page in the shared browser: its text, roles and names, to understand it or find elements to click. Give a selector to read only part of the page.", { selector: { ...selector, description: "Optional: only this element and what it contains." } }, [], async (params, signal) => {
    const result = await call({ action: "snapshot", selector: params.selector }, signal);
    return { content: [{ type: "text", text: `${page(result)}\n\n${result.snapshot}` }], details: { url: result.url, title: result.title } };
  });
  tool("browser_screenshot", "Look at the page", "A screenshot of what the shared browser shows right now, of one element, or of the whole scrolling page.", { selector: { ...selector, description: "Optional: only this element." }, fullPage: { type: "boolean", default: false, description: "The whole page, not just the visible part." } }, [], async (params, signal) => {
    const result = await call({ action: "screenshot", selector: params.selector, fullPage: params.fullPage }, signal);
    return { content: [{ type: "text", text: page(result) }, { type: "image", data: result.image, mimeType: "image/jpeg" }], details: { url: result.url, title: result.title } };
  });
  tool("browser_click", "Click in the page", "Click an element in the shared browser (it is scrolled into view first).", { selector, button: { type: "string", enum: ["left", "right", "middle"], default: "left" }, clickCount: { type: "integer", minimum: 1, maximum: 3, default: 1, description: "2 for a double click." } }, ["selector"], async (params, signal) => {
    const result = await call({ action: "click", selector: params.selector, button: params.button, clickCount: params.clickCount }, signal);
    return { content: [{ type: "text", text: `Clicked. Now at ${page(result)}` }], details: result };
  });
  tool("browser_type", "Type into the page", "Fill a text field in the shared browser (replacing its text, or appending), optionally pressing Enter afterwards.", { selector, text: { type: "string", maxLength: 10000 }, submit: { type: "boolean", default: false }, append: { type: "boolean", default: false, description: "Add to the end of the existing text instead of replacing it." } }, ["selector", "text"], async (params, signal) => {
    const result = await call({ action: "type", selector: params.selector, text: params.text, submit: params.submit, append: params.append }, signal);
    return { content: [{ type: "text", text: `Typed. Now at ${page(result)}` }], details: result };
  });
  tool("browser_press", "Press a key", "Press a key or shortcut in the shared browser, e.g. Enter, Escape, Tab, ArrowDown, PageDown, Backspace, Control+a, Shift+Tab. With a selector, that element gets focus first.", { key: { type: "string", minLength: 1, maxLength: 60 }, selector: { ...selector, description: "Optional: focus this element first." } }, ["key"], async (params, signal) => {
    const result = await call({ action: "press", key: params.key, selector: params.selector }, signal);
    return { content: [{ type: "text", text: `Pressed ${params.key}. Now at ${page(result)}` }], details: result };
  });
  tool("browser_hover", "Hover over an element", "Move the mouse over an element in the shared browser, e.g. to open a menu or show a tooltip.", { selector }, ["selector"], async (params, signal) => {
    const result = await call({ action: "hover", selector: params.selector }, signal);
    return { content: [{ type: "text", text: `Hovering over ${params.selector}.` }], details: result };
  });
  tool("browser_select", "Choose in a dropdown", "Choose one or more options of a <select> element in the shared browser, by value or label.", { selector, values: { type: "array", items: { type: "string", maxLength: 1000 }, minItems: 1, maxItems: 50 } }, ["selector", "values"], async (params, signal) => {
    const result = await call({ action: "select", selector: params.selector, values: params.values }, signal);
    return { content: [{ type: "text", text: `Selected ${JSON.stringify(result.selected)}.` }], details: result };
  });
  tool("browser_scroll", "Scroll the page", "Scroll the shared browser. With only a selector, scroll that element into view. With dx/dy (pixels, positive is down/right) or to=top/bottom, scroll the page, or the element given by selector (a list or panel with its own scroll bar). With nothing, scroll down one screen.", { selector: { ...selector, description: "Optional: the element to bring into view, or to scroll inside." }, dx: { type: "number" }, dy: { type: "number" }, to: { type: "string", enum: ["top", "bottom"] } }, [], async (params, signal) => {
    const result = await call({ action: "scroll", selector: params.selector, dx: params.dx, dy: params.dy, to: params.to }, signal);
    return { content: [{ type: "text", text: `Scrolled. Page at ${result.scrollY}px of ${result.scrollHeight}px (viewport ${result.viewportHeight}px).` }], details: result };
  });
  tool("browser_wait", "Wait for the page", "Wait until an element appears (or disappears, with state), some text is visible, the URL contains a string, or the page reaches a load state (networkidle waits for requests to settle). With none of these, just wait timeoutMs (at most 10 s).", { selector: { ...selector, description: "Optional." }, state: { type: "string", enum: ["visible", "hidden", "attached", "detached"], default: "visible" }, text: { type: "string", maxLength: 1000 }, url: { type: "string", maxLength: 4000, description: "Part of the URL to wait for." }, load: { type: "string", enum: ["load", "domcontentloaded", "networkidle"] }, timeoutMs: { type: "integer", minimum: 0, maximum: 30000, default: 10000 } }, [], async (params, signal) => {
    const result = await call({ action: "wait", ...params }, signal);
    return { content: [{ type: "text", text: `Done after ${result.waitedMs} ms. Now at ${page(result)}` }], details: result };
  });
  tool("browser_navigate", "Back, forward or reload", "Go back, forward, or reload the page in the shared browser.", { go: { type: "string", enum: ["back", "forward", "reload"] } }, ["go"], async (params, signal) => {
    const result = await call({ action: "history", go: params.go }, signal);
    return { content: [{ type: "text", text: `Now at ${page(result)}` }], details: result };
  });
  tool("browser_evaluate", "Run JavaScript in the page", "Evaluate a JavaScript expression in the page of the shared browser and return its result as JSON (promises are awaited). For statements, wrap them: (() => { ...; return value })(). Useful to read app state, check computed styles or debug.", { expression: { type: "string", minLength: 1, maxLength: 20000 } }, ["expression"], async (params, signal) => {
    const result = await call({ action: "evaluate", expression: params.expression }, signal);
    return { content: [{ type: "text", text: result.result }], details: { url: result.url, title: result.title } };
  });
  tool("browser_console", "Read the console", "The page's recent console messages, uncaught errors and failed or 4xx/5xx requests in the shared browser, oldest first.", { errorsOnly: { type: "boolean", default: false, description: "Only errors and warnings." }, limit: { type: "integer", minimum: 1, maximum: 300, default: 50 }, clear: { type: "boolean", default: false, description: "Empty the log afterwards, to see only what happens next." } }, [], async (params, signal) => {
    const result = await call({ action: "console", ...params }, signal);
    const lines = result.entries.map((e) => `${new Date(e.at).toISOString().slice(11, 19)} [${e.kind === "console" ? e.level : e.kind}] ${e.text}`);
    return { content: [{ type: "text", text: lines.length ? lines.join("\n") : "Nothing logged." }], details: { url: result.url, count: lines.length } };
  });
  tool("browser_close", "Close the browser", "Close the session's shared browser for everyone.", {}, [], async (_params, signal) => {
    await call({ action: "close" }, signal);
    return { content: [{ type: "text", text: "Browser closed." }], details: {} };
  });
}
