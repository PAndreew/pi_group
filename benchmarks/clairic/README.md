# Does Clairic extraction save tokens?

A reproducible, synthetic A/B pack. **Preparing, grading and reporting make no model/API calls.** No app restart is performed by these scripts. There is deliberately no automatic paid-run launcher.

The hypothesis is: **Clairic reduces the main agent's input while preserving answer quality, and possibly lowers combined cost.** Clairic also consumes tokens. Smaller agent context does not necessarily mean fewer tokens processed across both models, lower cost, or faster completion.

## What's prepared

| Task | Requires | Failure this can expose |
|---|---|---|
| [incident prompt](generated/prompts/incident.txt) | Diagnose a checkout failure from a noisy log | Missing causal evidence or confusing deployment/failure times |
| [policy prompt](generated/prompts/policy.txt) | Resolve a plan-specific refund exception | Losing a qualifier or applying a conflicting general rule |
| [payments prompt](generated/prompts/payments.txt) | Reconcile captures/refunds with duplicate events | Losing identifiers/statuses and producing wrong arithmetic |

Each task's first query returns 190 matching lines, approximately 30–36 KB: above the 6,000-character extraction threshold but below ordinary Pi tool truncation and the auxiliary request limit. Exact file `read` results are deliberately **not** the target: our integration preserves them unchanged.

These are **controlled broad-retrieval stress tests**, not representative coding benchmarks. The imposed first broad query exercises the feature; it can exaggerate benefit versus an agent choosing a narrow query itself. If this pilot passes, repeat on natural tasks without that instruction before generalising.

## 1. Prepare — free, no restart

From the repository root:

```bash
python benchmarks/clairic/prepare.py
python -m unittest discover -s benchmarks/clairic -p 'test_*.py'
```

Preparation refuses to overwrite existing resources. A fresh dataset can instead use `--output PATH`; use that same path as `--root` when collecting results.

Generated layout (ignored by Git):

```text
generated/
  workspaces/incident/data/events.log
  workspaces/policy/data/policy.txt
  workspaces/payments/data/payments.log
  prompts/incident.txt
  prompts/policy.txt
  prompts/payments.txt
  expected.json       # human/grader only; not agent context
  schedule.json       # 18 planned trials, NOT scheduled Beezy jobs
  results/            # empty until real trials are collected
```

The golden answers, prompts and file hashes are deterministic. Workspaces contain only task data. Instructing the agent not to inspect parent folders is an experimental rule, **not OS-level isolation**; for stronger blinding use a sandbox exposing only the task workspace. Do not give the tested agent this README or the answer-key file.

## 2. Activation prerequisite — not done automatically

The app must eventually be built/restarted by you or with your explicit approval, and agent sessions reopened to load the extension. This pack includes a small extension audit addition, so the runtime must include that addition too. Until then, preparing resources is possible but an app-side A/B trial cannot prove the new integration works.

The audit uses non-model-facing Pi custom entries, `beezy-assistance-extraction`, containing only run/tool IDs, whether excerpts were used, and original/context **character** counts. It does not copy prompts/excerpts or claim exact token savings. The collector rejects an assisted trial lacking this evidence, even if a Clairic API request happened.

Keep **Clef off** and **tool selection off** throughout. No scripts change your settings, credentials, service state or budget. Choose a main-model spending budget before running anything: auxiliary budgets do **not** cap main-agent spending.

## 3. Run just one smoke pair first — paid, manual

Use the `incident` task and two fresh Pi RPC sessions:

1. Pick the same main provider/model and thinking level for both; do not switch mid-run.
2. Create session **A** with working folder `benchmarks/clairic/generated/workspaces/incident` and **all three switches off**.
3. Paste the exact contents of `generated/prompts/incident.txt` as the sole user prompt. Let it finish without steering or follow-ups. Time submission to final completion with a stopwatch if latency matters.
4. Collect the result immediately using the instructions below.
5. Wait until idle, enable **Clairic context extraction only**, and save settings.
6. Create fresh session **B** in the identical working folder. Paste the **same** prompt, with identical model/thinking settings. Let it finish and collect it.
7. Turn extraction off again when finished, if desired.

Do not run another conversation in the same test session, pre-load files or provide the answer keys. Targeted follow-up **tool queries by the agent** are allowed and are part of the measured cost. Human follow-up prompts invalidate the trial. Do not run A/B simultaneously: user settings affect active runs and shared provider caches make interpretation harder.

Both smoke trials must have correct answers with supporting citations. B must also have an extraction audit with `applied: true` and matching successful Clairic usage. A preserved original in the visible transcript is expected: only the model-context copy is filtered.

## 4. Collect real measurements — free/read-only

Locate each test session's original JSONL file under your configured Pi sessions directory (usually `~/.pi/agent/sessions/`). Its filename includes the session UUID from the Beezy session key. Set the paths below locally; **never upload or share Beezy's whole `db.json`**, which contains private account data.

```bash
python benchmarks/clairic/results.py record \
  --task incident --condition baseline --repeat 1 --thinking medium \
  --session /path/to/baseline-session.jsonl \
  --app-db /path/to/DATA_DIR/db.json \
  --elapsed-seconds 45.2 \
  --output benchmarks/clairic/generated/results/incident-baseline-1.json

python benchmarks/clairic/results.py record \
  --task incident --condition clairic --repeat 1 --thinking medium \
  --session /path/to/clairic-session.jsonl \
  --app-db /path/to/DATA_DIR/db.json \
  --elapsed-seconds 40.1 \
  --output benchmarks/clairic/generated/results/incident-clairic-1.json
```

The example durations are placeholders, **not measured results**. Supply actual elapsed time or omit the option; omitted time remains unknown rather than being estimated from message timestamps. `--thinking` must match the level actually selected. Collection refuses to overwrite an existing result.

The collector:

- verifies fixture/prompt hashes, task cwd, one exact prompt and the required broad search;
- grades fields and checks verbatim citations against original source lines;
- sums the main agent's actual reported input/output/cache usage and cost;
- reads only matching auxiliary records from app state and exports numeric measurements, never credentials/account records or the answer text;
- requires Clairic-only settings, matching run IDs, successful auxiliary calls and proof of context replacement;
- records recovery calls, character counts and optional measured elapsed time.

Collect immediately after each trial: auxiliary records are retained only for the last 200 calls per account. Missing records, failures, truncated extractions and mismatched settings invalidate the comparison; they are not counted as successful baseline-like runs. Missing or zero model pricing leaves **dollar savings unknown** without preventing a valid token-only comparison. A correctness failure stays visible even when excluded from like-for-like savings calculations.

## 5. Compare, then expand only if useful

```bash
python benchmarks/clairic/results.py report \
  benchmarks/clairic/generated/results/*.json
```

A pair is compared only when task, repetition, fixture hash, prompt hash, main model and thinking match, both runs are valid, and both pass the quality rubric. Session reuse is rejected. The report shows correctness separately and labels excluded/failed trials: savings among successful pairs are **not** an overall benefit claim if other assisted trials failed.

Inspect three distinct outcomes:

1. **Main input volume:** uncached input + cache reads + cache writes, following Beezy's usage accounting.
2. **All-model input volume:** the above plus Clairic input tokens. This can increase even when the main context shrinks; different models' tokens are not economically equivalent.
3. **Combined cost:** main model + Clairic, only with reported, nonzero main pricing. Do not infer dollar savings from OAuth/subscription providers whose prices are unknown or reported as zero.

Output tokens, each cache component, auxiliary calls, recovery calls and elapsed time remain separate in the result JSON. Character counts are a smoke-test diagnostic, not token estimates. Lower input alone does not prove equal answer quality, lower total cost or lower latency.

If the smoke pair works, follow `schedule.json`: three tasks × two conditions × three repetitions = **18 paid agent runs total**, including the smoke pair. The order alternates A/B and B/A to reduce order bias. Provider-side caching cannot be reset reliably here; retain cache breakdowns and interpret the small sample descriptively, not as statistical proof. No automated significance claim is made.

If Clairic omits evidence, causes extra retrieval, increases cost, or does not reduce context, that is a useful negative result—not a reason to discard a run and keep sampling until it looks good.
