# Applets

An applet is a reusable form or dashboard. It can launch an agent for a task such as document translation, or save and display data without an agent. Start with **Applets → Add Todo Dump**, or ask the agent to build one. It calls its `propose_applet` tool (`server/extensions/applets.mjs`, pi sessions only), and the applet is saved **waiting for approval**. Its page is `/apps/<slug>` (inside the app this is `#app=<slug>`). The grid icon below the message box lists every applet. An amber dot on the icon means one is waiting for you to approve it.

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
- **actions** (1–5) are buttons with an `id` and `label`. A button with a `prompt` starts an agent session and fills in its template:
  - `{{id}}` is replaced with the field's value. File and folder paths are relative to the applet's folder and wrapped in backticks. Lists are comma-separated. A checkbox reads yes or no.
  - `{{#id}}…{{/id}}` is kept only when the field is set (checked or non-empty). `{{^id}}…{{/id}}` is kept only when it is not.
  - A template may only name fields that exist.
- To act without an agent, omit `prompt` and choose a built-in browser action:
  - `{ "id": "guide", "label": "Open guide", "type": "open_url", "url": "https://example.com/guide" }` — opens an absolute HTTP(S) link in a new tab.
  - `{ "id": "copy", "label": "Copy template", "type": "copy_text", "text": "Name: " }` — copies literal text to the clipboard.
  - `{ "id": "reset", "label": "Reset", "type": "reset_form" }` — restores the field defaults and clears file and folder selections.
  - These buttons don't require filled-in fields, start sessions, or create run history. Their payloads are not templates.

## SQLite-backed applets

**Todo Dump** is a built-in template. Open **Applets → Add Todo Dump**, review the proposal, then approve it. **Save entry** stores the original text immediately. **Categorize pending** is the only button that calls an agent: it reads up to 12 uncategorized entries, classifies them, and saves structured fields. The inbox, item counts, average days between dated purchases, and monthly chart all read directly from SQLite. “Buy coffee” is a task; only a completed purchase contributes to the purchase views. Undated purchases are excluded from the monthly chart and average gap. Corrections and deletion use the record ID from the inbox. The template never replaces an existing applet at that slug.

Other applets use the same `data` block in `propose_applet`. For example, an expense applet can insert into `expenses`, group by month, and sum `amount`:

```json
{
  "collections": [{ "id": "expenses", "columns": { "category": "text", "amount": "number" } }],
  "writes": [{ "id": "addExpense", "collection": "expenses", "type": "insert", "columns": ["category", "amount"] }],
  "reads": [{ "id": "monthly", "collection": "expenses", "type": "summary", "groupBy": "createdAt", "bucket": "month", "metrics": [{ "id": "total", "op": "sum", "column": "amount" }] }],
  "views": [{ "id": "spending", "title": "Monthly spending", "type": "chart", "read": "monthly", "chart": "bar", "x": "createdAt", "y": "total", "label": "Spending", "unit": "€" }]
}
```

With `category` and `amount` form fields, add this action to the applet's `actions`:

```json
{ "id": "save", "label": "Save expense", "type": "data_write", "write": "addExpense", "fields": { "category": "category", "amount": "amount" }, "reset": true }
```

- **Collections:** `text`, `number`, `boolean`, and `date` (`YYYY-MM-DD`) columns accept null. Every record gets a numeric `id` and a UTC `createdAt`; neither can be written. Approved collections can gain columns, but existing ones cannot be removed or retyped. Each collection holds up to 5,000 records per user, up to 32 KB each.
- **Writes:** `insert`, `update`, or `delete`. Map write column IDs to scalar form field IDs, including `id` for update/delete. `reset: true` clears only those fields after success. `section` labels a collapsible group for secondary actions. An `ifEmpty` column lets an update skip records already filled, so agent classification does not overwrite manual edits.
- **Reads:** `rows` projects specified columns and sorts by record ID (`newest` or `oldest`). `summary` groups non-null values, optionally by day/month for dates, and computes `count`, `sum`, `avg`, or `gapDays`. A `where` object adds exact-match filters; `null` matches missing or null fields. Charts take a numeric `y`; tables choose and label returned columns.
- **Agent tools:** In private Pi sessions, `applet_data_read` runs approved named reads for the signed-in user. Prefer summaries; row reads return a bounded page and `nextOffset`. `applet_data_write` can run only writes explicitly marked `agent: true`. A prompt action with `noInputs: true` can start a batch without copying form inputs into the prompt. For recurring categorization, set up a private Pi scheduled prompt that reads and processes one pending batch; the template does not create a schedule automatically.
- **Privacy:** Beezy scopes reads and writes to the tenant, applet, and current user. Users of the same applet do not see each other's records. SQLite lives in `DATA_DIR/applet-data.sqlite`; the browser and agent APIs cannot submit SQL. Private agent tool results may still be recorded in the session transcript, so don't share a session that read private records.

## Running

A prompt button starts a **new session** in the applet's folder, which is the folder of the session that proposed it. The session belongs to the person who pressed the button and uses their default harness and model. It is named "🧩 title" and receives the filled-in prompt, headed with the applet and action name.

Run sessions don't appear in the chat list. They appear on the applet page under **Your runs**, which shows each run's status, its inputs, and the agent's final reply with clickable file links. A run's **Open session** button lets you watch it or follow up. Each person sees only their own runs, and the last 30 per applet are kept.

## Approval and changes

- Until it is approved, only its owner (the owner of the proposing session) and admins can see an applet. Either of them can approve it, after reviewing what its buttons do. After that, everyone in the tenant can use it, and each run acts as the person who pressed the button.
- When an agent proposes an existing slug, that applet changes. Agents call `list_applets` to start from the current spec. If the applet is already approved, the change is kept as a draft: the owner sees a preview and can approve or discard it, and the approved version keeps working in the meantime.
- A slug belongs to one applet per tenant. An agent working for someone else cannot take it over.
- Only the owner or an admin can delete an applet. Deleting it permanently removes its run history and all users’ saved records for that applet, but not its sessions.

## API

| Route | |
|---|---|
| `GET /api/applets` | Applets the user can see |
| `GET /api/applets/:idOrSlug` | Spec (plus draft, for managers) and the user's runs |
| `POST /api/applets/:id/approve` `{version}` | Approve the applet or its draft; a stale `version` is refused |
| `DELETE /api/applets/:id/draft` | Discard the waiting change |
| `POST /api/applets/:id/run` `{action, values}` | Start a run |
| `POST /api/applets/templates/todo-dump` | Create the Todo Dump proposal without an agent |
| `GET /api/applets/:id/data/views` | Read dashboard views (`view` and `offset` for paging) |
| `POST /api/applets/:id/data/write` `{action, values}` | Run an approved data button without a session |
| `POST /api/applet-data-bridge/:key/read` and `/write` | Named operations via a private Pi session’s owner-bound credential |
| `DELETE /api/applets/:id` | Delete |
| `GET/POST /api/applet-bridge/:key` | The agent's tools, behind the session's bridge credential |
