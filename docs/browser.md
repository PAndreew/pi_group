# Shared browser

Every session can have a headless Chromium that everyone viewing the session sees live: open it with the globe icon below the message box. The agent drives the same browser, so it can start your app and show it to you. Picking elements (the crosshair) turns them into references for your next message.

Status: a spike. It works end to end but is not hardened yet; see [Limits](#limits).

## Using it

- **Open a page:** type a URL (`localhost:5173`, `example.com`) in the address bar, or ask `@pi start the app and open it in the browser`.
- **Drive it:** click, scroll, and type as in a normal browser. On a phone, the keyboard button opens a text box that types into the focused field. The first person to open a browser sizes it to their panel. The phone/monitor button switches between a phone-sized viewport and one that fits your panel.
- **Pick elements:** turn on the crosshair. Click one element, or drag a rectangle around several (you get the outermost elements inside it). To reach an element covered by another (an overlay, a lower z-index layer, the container around what you point at), scroll the mouse wheel or press ↓/↑: the outline steps through everything stacked under the pointer, labeled like `2/5 div.card`, and the click picks the highlighted one. Moving the pointer starts again from the top. Hold Shift to keep picking. Each pick becomes a chip above the message box, with a screenshot.
- **Several people:** everyone in the session sees the same page. Anyone with write access can drive it; view-only members watch. Picks go into the composer of the person who made them.

The browser closes when nobody has watched it and the agent has not used it for `BROWSER_IDLE_MIN` minutes, or when someone presses the power button.

## What a pick sends

When you send the message, Beezy adds a "Referenced page elements" block and uploads the screenshots as attachments, so models that take images see them:

```
Referenced page elements (picked in the shared browser):
1. On http://localhost:5173/settings (My app), screenshot picked-1792949593190-1.png:
   - `button[data-testid="save"]` "Save" (component SettingsForm, source src/Settings.tsx:42) at 41,100 64×28
     `<button data-testid="save" class="btn">Save</button>`
```

The chat shows this block without the HTML lines.

**Source locations** come from whichever of these the page provides, in order:
- `data-insp-path` attributes from [code-inspector-plugin](https://github.com/zh-lx/code-inspector), the most reliable option. Add it to your Vite, webpack or Next.js config in development.
- `data-inspector-*` attributes from react-dev-inspector.
- Vue's component file (`__file`) in development builds.
- React's debug info: `_debugSource` up to React 18, or the owner's stack from React 19 (approximate).

## Agent tools

`server/extensions/browser.mjs` (pi sessions only) gives the agent `browser_open`, `browser_snapshot` (the accessibility tree), `browser_screenshot`, `browser_click`, `browser_type` and `browser_close`. They reach the server through the session's bridge credential at `/api/browser-bridge/<session>`. The selectors in picks work with `browser_click` and `browser_type`.

## Setup

The server needs `playwright-core` (an optional dependency; installed by `npm ci`) and a Chromium-based browser. It uses, in order:
1. `BROWSER_EXECUTABLE`.
2. A system Chromium, Chrome or Edge in the usual places.
3. The browser from `npx playwright install chromium`.

On a Raspberry Pi, `sudo apt install chromium` is enough.

| Setting | Default | |
|---|---|---|
| `BROWSER_EXECUTABLE` | auto | Path to the Chromium/Chrome/Edge binary. |
| `BROWSER_IDLE_MIN` | 10 | Close an unwatched, unused browser after this many minutes. |
| `BROWSER_MAX_SESSIONS` | 4 | Browsers open at once, across all sessions. |

## How it works

`server/src/browser.ts` keeps one Chromium process and one browser context per session (separate cookies and storage). It streams the page with the Chrome DevTools Protocol's screencast: JPEG frames, sent only when the page changes, to every viewer over `/api/browser?key=<session>`. Input travels back over the same socket as JSON and is replayed with `Input.dispatchMouseEvent` and Playwright's keyboard. Picks run a small script in the page (`PICK`) that finds the elements and describes them, and the server adds a cropped screenshot.

## Limits

- **Network reach:** the browser can open anything the server can reach, including your local network. That is no more than anyone who can prompt the agent can already do, so driving it needs write access to the session. Only `http`/`https` URLs open, and downloads are off.
- **Input:** IME composition and dead keys are not forwarded from the page surface; use the text box. There is no clipboard copy out of the page.
- **One tab:** popups open in the same page.
- **Resources:** each browser takes roughly 100–300 MB, plus the shared Chromium process.
