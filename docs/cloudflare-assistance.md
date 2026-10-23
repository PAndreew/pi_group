# Optional Cloudflare assistance

Three independent user-menu switches, all **off by default**:

- **Prompt injection checks — Clef:** classify incoming prompt text and model-facing tool text.
- **Relevant tool context — Clairic:** extract verbatim passages from eligible large tool results.
- **Tool selection — Clairic:** discover and activate a small subset of registered tools instead of exposing the full registered catalogue.

These are paid, experimental aids, not permission controls or a security boundary. Existing access checks, tool execution rules and approvals still apply. Clairic is a preview model. No provider means the default, disabled configuration works as before.

## Credentials

Both models use **one Cloudflare account and one API token**. In the Cloudflare dashboard create an account-scoped token with **Workers AI: Read**, restricted to the intended account. The account must have Workers AI available and any required billing enabled. Use the account ID, not a zone ID.

Preferred: keep the token in your **Secret vault**, under `CLOUDFLARE_WORKER_KEY`, and configure only its reference and the non-secret account ID in the private `.env` file or service environment:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_VAULT_KEY=CLOUDFLARE_WORKER_KEY
```

Beezy reads this key from the **initiating user's vault in the run's tenant**, never another user's or another tenant's vault. Other users/tenants need their own key under the same name. Values are fetched server-side on demand, not cached or copied to app storage, and rotation/revocation applies to subsequent calls. A missing/unreachable credential fails without a model request or cost reservation. The configured key is hidden from agent vault listings and denied by the agent's vault read endpoint; users can still manage it in their own vault UI.

Alternatively, set `CLOUDFLARE_API_TOKEN` in the server environment for one shared server credential. This explicitly takes precedence over the vault reference. Keep it out of chat, frontend code, user preferences and scheduled jobs. One token serves `@cf/cloudflare/clef` and `@cf/cloudflare/clairic`; separate model keys are unnecessary. Beezy keeps direct credentials in server configuration and removes them from the inherited process environment used by agents, terminals and job scripts. This is not OS-level isolation: a trusted shell-capable agent can still access files as its OS user.

Wrangler is not required: the server calls the Workers AI HTTPS API directly. Wrangler was not installed in the implementation environment. An existing Wrangler login does not automatically configure this integration, and no token was created or Cloudflare account modified during implementation.

When an operator later chooses to release this change, the configured server must be rebuilt/restarted in the normal way, and existing Pi child processes reopened so they load the new extension. **Implementation itself does not require deployment or enabling any switch.** Opening settings checks configuration and, for vault mode, the caller's vault-key metadata. It does not read the token value or validate it against Cloudflare, and makes no Cloudflare request.

## Settings and spending

Open **user menu → Cloudflare assistance**. Each feature is independently switchable. Click **Save settings** after changing switches; **Turn all off** prepares all three switches for saving.

- The initiating user's settings and account pay for their run, including chat turns, forwarded messages, memory runs and scheduled prompt steps.
- A run snapshots settings. New features start on the next idle run; disabling a feature is respected at the next runtime check. Already dispatched calls may still be billed.
- While an assisted run is busy, another initiating user or different settings cannot replace its configuration. Wait until it finishes before submitting under another configuration. Same-user follow-ups/steering with unchanged settings share that run's call limit.
- Daily budget defaults to **$1 per user, UTC**, with **40 auxiliary calls per run**. Set a zero daily budget to forbid dispatch. Budget accounting is shared across tenants and sessions for the account.
- Requests reserve cost before dispatch and persist it. Successful responses reconcile against reported input-token usage. Unknown/failed calls retain a conservative estimate; automatic retries are deliberately absent.
- Current documented rates: Clef **$0.24/million input tokens**; Clairic **$0.10/million input tokens**. These local estimates are not the Cloudflare invoice or a billing guarantee.
- Settings show today's auxiliary cost/calls and the latest 20 calls, with model, purpose, tokens, latency, outcome and run ID. Up to 200 recent call records are kept per user; the current daily meter persists separately. This usage is separate from the existing main-agent usage panel.

## What happens at runtime

### Prompt admission

Every app-side prompt path passes through the common submission function. Admission is serialized per session so simultaneous submissions cannot replace each other's initiating identity during a Clef request. The Pi adapter verifies that its assistance extension loaded before any enabled assisted prompt is admitted.

Clef gets source provenance and a typed `noul` question about attempted instruction overrides, impersonation or unauthorised actions. It is instructed to distinguish direct user requests and quoted attack examples from actual attacks. A probability of **0.5 or higher** rejects the prompt. This initial threshold is experimental, not calibrated assurance.

A suspicious prompt, timeout, invalid response, provider failure, exceeded input limit or exhausted budget is **not submitted**. The error explains why. To deliberately proceed, revise the prompt or explicitly turn off injection checks in settings and resubmit. There is no automatic bypass or one-click exception token.

Image prompts are rejected while injection checking is enabled: this first version is text-only and does not silently label an unexamined image safe. Images can still be used with injection checks off.

### Model-facing context

The Pi extension intercepts the `context` event **before each model request**, not the web stream. Saved tool results remain unchanged and visible in the transcript; only the context copy changes.

When Clef checking is enabled, suspicious or unchecked tool content is withheld from model context. Images in tool results are withheld because image checks are not yet supported. Clef decisions are cached by content within the run. Turning protection off is an explicit user choice; it exposes originals on subsequent requests.

Clairic extracts text only from eligible text-only results longer than 6,000 characters. It uses one typed `list` of `text` field, with the current delivered user task as extraction guidance. The server validates confidence, exact source spans (including Unicode offsets), null values and the 12,000-character excerpt budget. It never substitutes a `guess` for a null answer. Pagination/truncation notices are also carried forward deterministically when recognised.

Small results, exact `read` results, edit/write results, errors, images and known approval/control tools are not compressed. Known credential tools and recognised credential-file reads are not sent to the auxiliary provider at all. This is **not general secret detection**: shell/search output and user prompts can still contain sensitive information. Only enable these features when sending that task's content to Cloudflare is acceptable.

Extracts are labelled untrusted data, with source tool name and `toolCallId`. `beezy_open_result` pages original text from the current transcript branch (12,000 characters per page); its output remains subject to injection checking but not re-extraction. Known credential results cannot be reopened through this helper. Extraction failure falls back to an explicitly marked original result, provided injection checking has allowed it.

Extraction caches are task-and-source-specific. A steering message or different task invalidates relevance, rather than reusing yesterday's brief. Originals remain available for a fuller view.

### Tool discovery

With tool selection enabled, the initial active set is `beezy_find_tools` and `beezy_open_result`. The full registered tool catalogue stays in the extension/server path. `beezy_find_tools(goal)` sends authorised baseline tool IDs/descriptions to Clairic and asks it to extract up to five relevant IDs. Unknown IDs and malformed answers are rejected. Tool activation is additive within a run; selected schemas become available to the main model on its next turn.

The agent still supplies arguments and executes through existing tools and approvals. Clairic neither executes tools nor authorises actions. Low-quality or unavailable routing never automatically exposes the full catalogue; refine the capability request or explicitly disable the switch.

Limits of this first version:

- Only the **Pi RPC harness** is supported. Enabled assistance rejects another harness rather than pretending it is active. `pi-durable` integration remains separate work.
- Tool routing concerns the registered Pi catalogue. A generic MCP gateway can itself return remote discovery results; those are ordinary tool results, not a separately brokered remote catalogue. Native MCP tools registered with Pi are selectable normally. A dedicated gateway catalogue integration is future work.
- Previously visible tool names/calls are not erased from existing conversations. Start fresh sessions for clean catalogue/context comparisons.
- No proactive event queue, persistent item index, autonomous triage or multimodal extraction was added. These remain roadmap work.
- External tools' source text and extraction instructions still require adversarial evaluation. Neither model's confidence is an authority or proof of safety.

## Compare benefit against cost

Use fresh sessions with the same main model, task and fixtures. Test baseline (all off), Clef alone, extraction alone, routing alone, then combinations. Record task completion/correctness, false-positive warnings, missed injections, omitted facts, recovery calls, irrelevant tool selections, agent tokens, total cost and elapsed time. Auxiliary telemetry alone cannot establish task success or net savings.

Include benign quoted attacks, direct user instructions, hostile retrieved pages, large logs, pagination, empty/null extracts, Unicode source spans, schema failures, provider timeouts and budget exhaustion. No replay/benchmark should send private production content without consent.

## Local validation without deployment

```bash
npm --prefix server run typecheck
cd server
npx tsx --test src/assistance.test.ts src/assistance-extension.test.ts src/assistance-vault.test.ts
cd ../web
npx tsc -b
npx vite build --outDir /tmp/beezy-assistance-web-build
```

Do **not** use the normal web build output directory to validate an undeployed change when a running server serves that same checkout's `web/dist`. Use a temporary output directory as above. The mocked tests incur no provider costs. Live token validity, model accuracy and end-to-end savings still need a later opt-in trial.

References: [Clef](https://developers.cloudflare.com/workers-ai/models/clef/), [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/), [roadmap](roadmap.md).
