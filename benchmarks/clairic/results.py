#!/usr/bin/env python3
"""Read-only trial collection and paired reporting. Never starts agents or calls APIs."""
import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import statistics


def text(message):
    content = message.get("content", [])
    return content if isinstance(content, str) else "\n".join(block.get("text", "") for block in content if block.get("type") == "text")


def grade(answer, spec, workspace):
    issues = []
    if not isinstance(answer, dict):
        return ["Final answer is not a JSON object"]
    for key, value in spec["answer"].items():
        actual = answer.get("answer", {}).get(key) if isinstance(answer.get("answer"), dict) else None
        if type(actual) is not type(value) or actual != value:
            issues.append(f"Incorrect answer field: {key}")
    evidence = answer.get("evidence", [])
    if not isinstance(evidence, list):
        return issues + ["Evidence is not a list"]
    cited = set()
    for item in evidence:
        if not isinstance(item, dict):
            issues.append("Malformed citation"); continue
        file, line, quote = item.get("file"), item.get("line"), item.get("quote")
        if file not in spec["files"] or type(line) is not int or not isinstance(quote, str) or not quote:
            issues.append("Invalid citation fields"); continue
        lines = (workspace / file).read_text().splitlines()
        if not 1 <= line <= len(lines) or quote not in lines[line - 1]:
            issues.append("Citation does not match its original source line"); continue
        cited.add((file, line))
    for item in spec["required_evidence"]:
        if (item["file"], item["line"]) not in cited:
            issues.append(f"Missing material evidence: {item['file']}:{item['line']}")
    return issues


def number(value):
    if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
        raise ValueError("Missing/invalid numeric usage; do not manufacture zero-token or zero-cost results")
    return value


def collect(args):
    root = args.root.resolve()
    spec = json.loads((root / "expected.json").read_text())[args.task]
    workspace = root / "workspaces" / args.task
    for file, expected_hash in spec["files"].items():
        if hashlib.sha256((workspace / file).read_bytes()).hexdigest() != expected_hash:
            raise ValueError("Fixture changed; regenerate in a new directory and rerun both conditions")
    expected_prompt = (root / "prompts" / f"{args.task}.txt").read_text()
    if hashlib.sha256(expected_prompt.encode()).hexdigest() != spec["prompt_hash"]:
        raise ValueError("Prompt changed; use a new experiment")
    entries = [json.loads(line) for line in args.session.read_text().splitlines() if line.strip()]
    headers = [entry for entry in entries if entry.get("type") == "session"]
    if len(headers) != 1 or not headers[0].get("id"):
        raise ValueError("Expected one original Pi session JSONL file, not an exported message array")
    session_key = "pi:" + headers[0]["id"]
    messages = [entry["message"] for entry in entries if entry.get("type") == "message"]
    users = [message for message in messages if message.get("role") == "user"]
    assistants = [message for message in messages if message.get("role") == "assistant"]
    issues = []
    if Path(headers[0].get("cwd", "")).resolve() != workspace.resolve():
        issues.append("Session cwd is not this task's fixture workspace")
    if len(users) != 1 or text(users[0]).strip() != expected_prompt.strip():
        issues.append("Not a fresh single-prompt session using the exact task prompt")
    if any(entry.get("type") in ("compaction", "branch_summary") for entry in entries):
        issues.append("Compacted/branched session: not comparable in this initial experiment")
    if not assistants:
        raise ValueError("No completed assistant messages")
    models = sorted({f"{m.get('provider')}/{m.get('responseModel') or m.get('model')}" for m in assistants})
    if len(models) != 1 or "None" in models[0]:
        issues.append("Main model changed or was not recorded")
    levels = {entry.get("thinkingLevel") for entry in entries if entry.get("type") == "thinking_level_change"}
    if levels and levels != {args.thinking}:
        issues.append("Thinking level does not match the declared experiment level")
    totals = dict(input=0, output=0, cacheRead=0, cacheWrite=0)
    costs = []
    calls = []
    for message in assistants:
        usage = message.get("usage", {})
        for key in totals:
            totals[key] += number(usage.get(key, 0) if key.startswith("cache") else usage.get(key))
        cost = usage.get("cost", {}).get("total")
        costs.append(number(cost) if cost is not None else None)
        calls.extend(block for block in message.get("content", []) if block.get("type") == "toolCall")
    main_cost = sum(costs) if all(cost is not None for cost in costs) else None
    measurement_notes = []
    if main_cost is None or main_cost == 0:
        main_cost = None
        measurement_notes.append("Main model price missing/zero; compare tokens but do not infer dollar savings without verified pricing")
    first = [call for call in calls if call.get("name") == "bash" and call.get("arguments", {}).get("command", "").strip() == spec["initial_command"]]
    if len(first) != 1:
        issues.append("Required initial broad search was not executed exactly once")
    elif not any(m.get("role") == "toolResult" and m.get("toolCallId") == first[0].get("id") and len(text(m)) > 6000 for m in messages):
        issues.append("Initial result was missing/too small; extraction path was not exercised")
    runs = [entry.get("data", {}) for entry in entries if entry.get("type") == "custom" and entry.get("customType") == "beezy-assistance-run"]
    audits = [entry.get("data", {}) for entry in entries if entry.get("type") == "custom" and entry.get("customType") == "beezy-assistance-extraction"]
    # Read app state locally; export only this session's numeric auxiliary usage.
    db = json.loads(args.app_db.read_text())
    auxiliary = [record for user in db.get("users", []) for record in user.get("assistanceRecords", []) if record.get("sessionKey") == session_key]
    if args.condition == "baseline":
        if runs or audits or auxiliary:
            issues.append("Baseline was not all-off")
    else:
        if len(runs) != 1 or runs[0].get("settings", {}).get("injectionChecks") is not False or runs[0].get("settings", {}).get("contextExtraction") is not True or runs[0].get("settings", {}).get("toolSelection") is not False:
            issues.append("Clairic-only settings snapshot is missing or incorrect")
        run_ids = {run.get("runId") for run in runs}
        if not any(a.get("applied") is True and a.get("runId") in run_ids for a in audits):
            issues.append("No model-context extraction audit: do not claim this tested extraction")
        if not auxiliary or any(r.get("model") != "clairic" or r.get("purpose") != "extract" or r.get("runId") not in run_ids for r in auxiliary):
            issues.append("Clairic-only auxiliary usage is missing/mismatched; collect before retention expires")
        if any(r.get("status") != "ok" for r in auxiliary):
            issues.append("Auxiliary failure/truncation/reservation estimate: trial not comparable")
    raw_answer = text(assistants[-1]).strip()
    if raw_answer.startswith("```json\n") and raw_answer.endswith("```"):
        raw_answer = raw_answer[8:-3].strip()
    try:
        answer = json.loads(raw_answer)
        grade_issues = grade(answer, spec, workspace)
        if answer.get("task") != args.task:
            grade_issues.append("Wrong task identifier")
    except (ValueError, AttributeError):
        grade_issues = ["Final assistant answer is not valid task JSON"]
    if assistants[-1].get("stopReason") in ("error", "aborted", "toolUse"):
        grade_issues.append("Session did not finish with a final answer")
    auxiliary_cost = sum(number(r.get("cost")) for r in auxiliary)
    return {"task": args.task, "condition": args.condition, "repeat": args.repeat,
            "fixture_hash": spec["fixture_hash"], "prompt_hash": spec["prompt_hash"],
            "session_key": session_key, "models": models, "thinking": args.thinking,
            "correct": not grade_issues, "grade_issues": grade_issues,
            "valid_trial": not issues, "trial_issues": issues, "measurement_notes": measurement_notes,
            "main_calls": len(assistants), "main_tokens": totals,
            "main_input_volume": totals["input"] + totals["cacheRead"] + totals["cacheWrite"],
            "main_cost_usd": main_cost, "auxiliary_cost_usd": auxiliary_cost,
            "combined_cost_usd": None if main_cost is None else main_cost + auxiliary_cost,
            "auxiliary_input_tokens": sum(number(r.get("inputTokens", 0)) for r in auxiliary),
            "all_model_input_volume": totals["input"] + totals["cacheRead"] + totals["cacheWrite"] + sum(number(r.get("inputTokens", 0)) for r in auxiliary),
            "auxiliary_calls": len(auxiliary), "extractions_applied": sum(a.get("applied") is True for a in audits),
            "source_characters": sum(a.get("sourceCharacters", 0) for a in audits),
            "context_characters": sum(a.get("contextCharacters", 0) for a in audits),
            "recovery_calls": sum(c.get("name") == "beezy_open_result" for c in calls),
            "elapsed_seconds": args.elapsed_seconds}


def report(rows):
    print("# Clairic A/B results\n")
    print("| Task | Condition | Correct | Valid trials | Median main input volume | Median combined USD |")
    print("|---|---|---:|---:|---:|---:|")
    groups = defaultdict(list)
    pairs = defaultdict(dict)
    seen = set()
    sessions = set()
    for row in rows:
        if row["session_key"] in sessions:
            raise ValueError("The same session was reused for more than one trial")
        sessions.add(row["session_key"])
        key = row["task"], row["repeat"], row["condition"]
        if key in seen:
            raise ValueError(f"Duplicate trial {key}; do not count the same run twice")
        seen.add(key)
        groups[row["task"], row["condition"]].append(row)
        pairs[row["task"], row["repeat"]][row["condition"]] = row
    for (task, condition), group in sorted(groups.items()):
        valid = [r for r in group if r["valid_trial"]]
        med = lambda key: f"{statistics.median(r[key] for r in valid):.6f}" if valid and all(r[key] is not None for r in valid) else "unknown"
        print(f"| {task} | {condition} | {sum(r['correct'] for r in group)}/{len(group)} | {len(valid)}/{len(group)} | {med('main_input_volume')} | {med('combined_cost_usd')} |")
    usable = []
    for pair in pairs.values():
        if set(pair) != {"baseline", "clairic"}:
            continue
        a, b = pair["baseline"], pair["clairic"]
        if all(r["valid_trial"] and r["correct"] for r in (a, b)) and all(a[k] == b[k] for k in ("fixture_hash", "prompt_hash", "models", "thinking")):
            usable.append((a, b))
    print(f"\nMatched, valid, fully correct pairs: {len(usable)} / {len(pairs)}.")
    if usable:
        for key, label in [("main_input_volume", "Main input volume"), ("all_model_input_volume", "All-model input volume"), ("combined_cost_usd", "Combined cost")]:
            measured = [(a, b) for a, b in usable if a[key] is not None and b[key] is not None]
            if not measured:
                print(f"- {label}: unknown; no pairs with verified measurement.")
                continue
            baseline = sum(a[key] for a, b in measured)
            assisted = sum(b[key] for a, b in measured)
            change = f"{100 * (assisted / baseline - 1):+.1f}%" if baseline else "undefined (zero baseline)"
            print(f"- {label}, {len(measured)} pairs: {baseline:.6f} → {assisted:.6f} ({change}).")
    if any(not row["correct"] or not row["valid_trial"] for row in rows):
        print("\nSome trials failed quality or validity checks. Paired savings above exclude them and are NOT an overall benefit claim.")
    print("\nInput volume = uncached input + cache reads + cache writes, following Beezy usage accounting. Output, cache components, cost and elapsed time remain separate in each result JSON. Character counts are NOT token savings. Synthetic tests do not establish general coding-task savings; small samples are descriptive only.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    record = sub.add_parser("record")
    record.add_argument("--root", type=Path, default=Path(__file__).resolve().parent / "generated")
    record.add_argument("--task", choices=["incident", "policy", "payments"], required=True)
    record.add_argument("--condition", choices=["baseline", "clairic"], required=True)
    record.add_argument("--repeat", type=int, choices=[1, 2, 3], required=True)
    record.add_argument("--session", type=Path, required=True, help="Original Pi session JSONL, read only")
    record.add_argument("--app-db", type=Path, required=True, help="Beezy DATA_DIR/db.json, read only; never exported")
    record.add_argument("--thinking", required=True)
    record.add_argument("--elapsed-seconds", type=float)
    record.add_argument("--output", type=Path, required=True)
    summary = sub.add_parser("report")
    summary.add_argument("files", type=Path, nargs="+")
    args = parser.parse_args()
    if args.command == "record":
        if args.output.exists():
            parser.error("Refusing to overwrite a result; choose a new path")
        if args.elapsed_seconds is not None:
            number(args.elapsed_seconds)
        result = collect(args)
        with args.output.open("x") as stream:
            json.dump(result, stream, indent=2)
            stream.write("\n")
        print(f"Recorded. Correct: {result['correct']}; valid comparison trial: {result['valid_trial']}")
        for issue in result["grade_issues"] + result["trial_issues"] + result["measurement_notes"]:
            print(f"- {issue}")
    else:
        report([json.loads(file.read_text()) for file in args.files])
