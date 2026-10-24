#!/usr/bin/env python3
"""Generate synthetic, deterministic extraction tests. No network/model calls."""
import argparse
import hashlib
import json
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def generate(root):
    if root.exists():
        raise ValueError(f"Refusing to overwrite {root}; use a new --output directory")
    root.mkdir(parents=True)
    expected = {}
    specs = [
        ("incident", "events.log", "service=checkout", {
            18: "2026-10-14T14:07:00Z service=checkout event=deploy version=2026.10.14-rc2 feature=receipt_v2 enabled=true",
            47: "2026-10-14T14:07:10Z service=checkout event=migrate column=receipt_hash result=failed code=MIGRATION_PERMISSION_DENIED actor=app_runtime detail=ALTER_TABLE_grant_missing",
            88: "2026-10-14T14:07:13Z service=checkout event=first_failure code=UNDEFINED_COLUMN column=receipt_hash request=req-77",
            133: "2026-10-14T14:12:40Z service=checkout event=mitigation action=rollback version=2026.10.13-stable",
            171: "2026-10-14T14:12:48Z service=checkout event=recovered success_rate=1.0 queue_depth=0",
        }, {
            "first_failure": "2026-10-14T14:07:13Z", "root_cause_code": "MIGRATION_PERMISSION_DENIED",
            "missing_column": "receipt_hash", "mitigation": "rollback", "recovered_at": "2026-10-14T14:12:48Z",
        }, "Diagnose the checkout incident: identify the first customer-facing failure, root cause, missing column, mitigation and recovery time. Do not confuse the deployment or migration time with the first customer-facing failure.",
         "2026-10-14T14:06:00Z service=checkout event=health region=eu-west result=ok status=200 latency_ms=83 component=metrics detail=periodic_observation_no_incident_evidence"),
        ("policy", "policy.txt", "POLICY-R17", {
            13: "POLICY-R17 section=scope plan=Academy region=EU applies_to=annual_renewal; this section overrides general renewal policy for Academy EU customers.",
            56: "POLICY-R17 section=general plan=Business region=ALL refund_window_days=14 fee_eur=20; NOT applicable to Academy EU annual renewals.",
            93: "POLICY-R17 section=academy_eu annual_renewal_refund_window_days=21 fee_eur=0; refund permitted only when no course was started after renewal.",
            142: "POLICY-R17 section=eligibility account=AC-701 plan=Academy region=EU days_since_annual_renewal=18 courses_started_after_renewal=0 amount_paid_eur=240",
            175: "POLICY-R17 section=processing eligible_full_refund_eur=240 settlement_method=original_payment_method settlement_business_days=7; Academy EU rule remains in force.",
        }, {
            "eligible": True, "refund_window_days": 21, "refund_eur": 240, "fee_eur": 0,
            "settlement_business_days": 7, "settlement_method": "original_payment_method",
        }, "Decide whether AC-701 is eligible for a renewal refund under POLICY-R17. Return the applicable window, refund, fee, settlement time and method. Resolve the plan-specific exception instead of applying the general policy.",
         "POLICY-R17 section=operations plan=Internal region=ALL topic=archive_retention action=retain note=administrative_material_not_a_customer_refund_rule_or_account_eligibility_decision"),
        ("payments", "payments.log", "order=ORD-8421", {
            22: "order=ORD-8421 event=authorization auth_id=AUTH-1 amount_minor=12900 currency=USD status=failed; this is not a charge",
            53: "order=ORD-8421 event=capture capture_id=CAP-77 amount_minor=12900 currency=USD status=succeeded delivery_id=DLV-1",
            97: "order=ORD-8421 event=capture capture_id=CAP-77 amount_minor=12900 currency=USD status=succeeded delivery_id=DLV-2 duplicate_delivery_of=DLV-1; same capture, not another charge",
            124: "order=ORD-8421 event=refund refund_id=REF-11 amount_minor=10000 currency=USD status=failed; no money returned",
            151: "order=ORD-8421 event=refund refund_id=REF-12 amount_minor=2900 currency=USD status=succeeded capture_id=CAP-77",
            178: "order=ORD-8421 event=refund refund_id=REF-13 amount_minor=5000 currency=USD status=pending; not settled, do not subtract from settled net",
        }, {
            "currency": "USD", "unique_successful_captures": 1, "captured_minor": 12900,
            "settled_refunded_minor": 2900, "settled_net_minor": 10000,
        }, "Reconcile ORD-8421. Deduplicate successful captures by capture_id, subtract only succeeded refunds, and report the settled net amount in minor units. Do not count failed authorisations, failed refunds or pending refunds as settled money movements.",
         "order=ORD-8421 event=observation status=informational component=telemetry currency=USD amount_minor=0 detail=heartbeat_only_no_capture_no_refund_no_financial_state_change"),
    ]
    for task, filename, pattern, anchors, answer, question, filler in specs:
        workspace = root / "workspaces" / task
        (workspace / "data").mkdir(parents=True)
        lines = [anchors.get(i, f"{filler} sequence={i:03d}") for i in range(1, 191)]
        raw = ("\n".join(lines) + "\n").encode()
        source = workspace / "data" / filename
        source.write_bytes(raw)
        command = f"rg -n '{pattern}' data/{filename}"
        # All lines match; approximate exact rg output without depending on rg here.
        search = "".join(f"{i}:{line}\n" for i, line in enumerate(lines, 1)).encode()
        if not 6000 < len(search) < 40000:
            raise ValueError("Fixture must exercise extraction without tool truncation")
        schema = {"task": task, "answer": {key: f"<{type(value).__name__}>" for key, value in answer.items()},
                  "evidence": [{"file": f"data/{filename}", "line": "<integer>", "quote": "<verbatim source text>"}]}
        prompt = f"""Work only in the current task folder; do not inspect parent folders, benchmark scripts, answer keys or other sessions. Do not modify files. This is a search-result reasoning task, not a coding task.

First execute this exact command once with bash:
{command}

{question}

Reason from the returned search result. Further targeted rg queries are allowed if needed. Do not bypass the search-result task with read, cat, sed, a custom parser or a new script. Use beezy_open_result if it is available and excerpts omit something necessary. No external tools or network are needed.

Return only JSON in this shape (replace type placeholders with actual values):
{json.dumps(schema, indent=2)}

Cite every material source line supporting the conclusion, including relevant conflicting rules or duplicate/failed/pending payment events. Line numbers refer to the original source file; quote exact text without the rg line-number prefix.
"""
        (root / "prompts").mkdir(exist_ok=True)
        (root / "prompts" / f"{task}.txt").write_text(prompt)
        expected[task] = {"answer": answer, "required_evidence": [{"file": f"data/{filename}", "line": i} for i in anchors],
                          "files": {f"data/{filename}": digest(raw)}, "fixture_hash": digest(raw),
                          "prompt_hash": digest(prompt.encode()), "initial_command": command,
                          "initial_result_bytes": len(search), "initial_result_lines": len(lines)}
    (root / "expected.json").write_text(json.dumps(expected, indent=2) + "\n")
    (root / "results").mkdir()
    schedule = []
    for repeat in range(1, 4):
        for index, task in enumerate(expected):
            order = ["baseline", "clairic"] if (repeat + index) % 2 else ["clairic", "baseline"]
            schedule.extend({"task": task, "repeat": repeat, "condition": condition} for condition in order)
    (root / "schedule.json").write_text(json.dumps(schedule, indent=2) + "\n")
    return expected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path(__file__).resolve().parent / "generated")
    args = parser.parse_args()
    specs = generate(args.output.resolve())
    print(f"Prepared {len(specs)} tasks and 18 planned trial slots at {args.output.resolve()}")
    print("No model calls made. Start with only one incident A/B smoke pair.")
