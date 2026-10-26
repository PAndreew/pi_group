# Applets

An applet is a small form for a task you run again and again, such as a document translator with a file picker and a language dropdown. Ask the agent for one. It calls its `propose_applet` tool (`server/extensions/applets.mjs`, pi sessions only), and the applet is saved **waiting for approval**. Its page is `/apps/<slug>` (inside the app this is `#app=<slug>`). The grid icon below the message box lists every applet. An amber dot on the icon means one is waiting for you to approve it.

Applets are declarative. The agent picks fields from a fixed set, and the server validates them (`appletSpec` in `server/src/applets.ts`). No code the agent writes runs in the browser.

## Template

```json
{
  "slug": "docx-translator",
  "title": "DOCX translator",
  "description": "Translate Word and PDF documents, keeping the layout.",
  "reason": "You asked for a form for the docx translator skill.",
  "fields": [
    { "type": "markdown", "text": "Pick the documents, then the language." },
    { "type": "file", "id": "files", "label": "Documents", "accept": [".docx", ".pdf"], "multiple": true },
    { "type": "select", "id": "target", "label": "Target language", "options": ["English", "German", "Hungarian"], "default": "English" },
    { "type": "textarea", "id": "glossary", "label": "Glossary", "optional": true },
    { "type": "checkbox", "id": "bilingual", "label": "Bilingual side-by-side version" }
  ],
  "actions": [
    { "id": "run", "label": "Translate", "prompt": "/skill:docx-translator\nTranslate {{files}} into {{target}}.{{#bilingual}} Also make a bilingual version.{{/bilingual}}\n{{#glossary}}Glossary:\n{{glossary}}{{/glossary}}" }
  ]
}
```

- **fields** (up to 25): `markdown` (help text), `text`, `textarea`, `number` (`min`, `max`, `step`), `select` (`options`, `multiple`), `radio` (up to 12 options), `checkbox`, `file` (`accept`, `multiple`) and `folder`. Every field except a checkbox is required unless it has `"optional": true`.
- **file and folder fields** are filled by uploading into `<applet folder>/uploads` or by browsing the shared root. The server checks that each path exists, is inside the root, and has an accepted extension.
- **actions** (1–5) are buttons. Each one has a prompt template:
  - `{{id}}` is replaced with the field's value. File and folder paths are relative to the applet's folder and wrapped in backticks. Lists are comma-separated. A checkbox reads yes or no.
  - `{{#id}}…{{/id}}` is kept only when the field is set (checked or non-empty). `{{^id}}…{{/id}}` is kept only when it is not.
  - A template may only name fields that exist.

## Running

A button starts a **new session** in the applet's folder, which is the folder of the session that proposed it. The session belongs to the person who pressed the button and uses their default harness and model. It is named "🧩 title" and receives the filled-in prompt, headed with the applet and action name.

Run sessions don't appear in the chat list. They appear on the applet page under **Your runs**, which shows each run's status, its inputs, and the agent's final reply with clickable file links. A run's **Open session** button lets you watch it or follow up. Each person sees only their own runs, and the last 30 per applet are kept.

## Approval and changes

- Until it is approved, only its owner (the owner of the proposing session) and admins can see an applet. Either of them can approve it, after reviewing the prompts its buttons send. After that, everyone in the tenant can use it, and each run acts as the person who pressed the button.
- When an agent proposes an existing slug, that applet changes. Agents call `list_applets` to start from the current spec. If the applet is already approved, the change is kept as a draft: the owner sees a preview and can approve or discard it, and the approved version keeps working in the meantime.
- A slug belongs to one applet per tenant. An agent working for someone else cannot take it over.
- Only the owner or an admin can delete an applet. Deleting it also removes its run history, but not its sessions.

## API

| Route | |
|---|---|
| `GET /api/applets` | Applets the user can see |
| `GET /api/applets/:idOrSlug` | Spec (plus draft, for managers) and the user's runs |
| `POST /api/applets/:id/approve` `{version}` | Approve the applet or its draft; a stale `version` is refused |
| `DELETE /api/applets/:id/draft` | Discard the waiting change |
| `POST /api/applets/:id/run` `{action, values}` | Start a run |
| `DELETE /api/applets/:id` | Delete |
| `GET/POST /api/applet-bridge/:key` | The agent's tools, behind the session's bridge credential |
