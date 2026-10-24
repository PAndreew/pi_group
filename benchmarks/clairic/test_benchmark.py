import argparse
import contextlib
import copy
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from prepare import generate
from results import collect, grade, report


class BenchmarkTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name) / "fixtures"
        self.specs = generate(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def answer(self, task):
        spec = self.specs[task]
        return {"task": task, "answer": spec["answer"], "evidence": [
            {**item, "quote": (self.root / "workspaces" / task / item["file"]).read_text().splitlines()[item["line"] - 1]}
            for item in spec["required_evidence"]]}

    def trial(self, condition="clairic"):
        task = "incident"
        spec = self.specs[task]
        workspace = self.root / "workspaces" / task
        prompt = (self.root / "prompts" / f"{task}.txt").read_text()
        usage = {"input": 2000, "output": 50, "cacheRead": 100, "cacheWrite": 0, "cost": {"total": .02}}
        entries = [
            {"type": "session", "id": "synthetic-unit-test", "cwd": str(workspace)},
            {"type": "thinking_level_change", "thinkingLevel": "off"},
            {"type": "message", "message": {"role": "user", "content": prompt}},
            {"type": "message", "message": {"role": "assistant", "provider": "test", "model": "fake", "usage": usage,
              "content": [{"type": "toolCall", "name": "bash", "id": "search-1", "arguments": {"command": spec["initial_command"]}}]}},
            {"type": "message", "message": {"role": "toolResult", "toolCallId": "search-1", "content": [{"type": "text", "text": (workspace / "data/events.log").read_text()}]}},
            {"type": "message", "message": {"role": "assistant", "provider": "test", "model": "fake", "usage": usage,
              "stopReason": "stop", "content": [{"type": "text", "text": json.dumps(self.answer(task))}]}},
        ]
        auxiliary = []
        if condition == "clairic":
            entries.extend([
                {"type": "custom", "customType": "beezy-assistance-run", "data": {"runId": "run-test", "settings": {"injectionChecks": False, "contextExtraction": True, "toolSelection": False}}},
                {"type": "custom", "customType": "beezy-assistance-extraction", "data": {"runId": "run-test", "toolCallId": "search-1", "applied": True, "sourceCharacters": 20000, "contextCharacters": 2000}},
            ])
            auxiliary = [{"sessionKey": "pi:synthetic-unit-test", "runId": "run-test", "model": "clairic", "purpose": "extract", "status": "ok", "cost": .003, "inputTokens": 30000}]
        session = Path(self.temp.name) / "test-session.jsonl"
        session.write_text("\n".join(json.dumps(entry) for entry in entries))
        db = Path(self.temp.name) / "test-db.json"
        db.write_text(json.dumps({"users": [{"passwordHash": "not-for-export", "assistanceRecords": auxiliary}]}))
        args = argparse.Namespace(root=self.root, task=task, condition=condition, repeat=1, thinking="off", session=session, app_db=db, elapsed_seconds=None)
        return args, entries

    def test_sources_are_deterministic_and_search_results_eligible(self):
        other = Path(self.temp.name) / "second"
        self.assertEqual(self.specs, generate(other))
        with self.assertRaises(ValueError):
            generate(other)
        for task, spec in self.specs.items():
            result = subprocess.run(spec["initial_command"], shell=True, cwd=self.root / "workspaces" / task, check=True, capture_output=True)
            self.assertEqual(len(result.stdout), spec["initial_result_bytes"])
            self.assertGreater(len(result.stdout), 6000)
            self.assertLess(len(result.stdout), 40000)
            self.assertEqual(grade(self.answer(task), spec, self.root / "workspaces" / task), [])

    def test_wrong_answers_and_fabricated_citations_fail(self):
        answer = copy.deepcopy(self.answer("payments"))
        answer["answer"]["settled_net_minor"] = 0
        answer["evidence"][0]["quote"] = "invented quote"
        issues = grade(answer, self.specs["payments"], self.root / "workspaces/payments")
        self.assertTrue(any("Incorrect" in issue for issue in issues))
        self.assertTrue(any("does not match" in issue for issue in issues))

    def test_collector_counts_actual_usage_and_includes_auxiliary_cost(self):
        args, _ = self.trial()
        result = collect(args)
        self.assertTrue(result["correct"])
        self.assertTrue(result["valid_trial"], result["trial_issues"])
        self.assertEqual(result["main_input_volume"], 4200)
        self.assertAlmostEqual(result["combined_cost_usd"], .043)
        self.assertEqual(result["auxiliary_input_tokens"], 30000)
        self.assertEqual(result["extractions_applied"], 1)
        self.assertNotIn("not-for-export", json.dumps(result))
        self.assertIsNone(result["elapsed_seconds"])

    def test_without_actual_context_audit_assisted_trial_is_invalid(self):
        args, entries = self.trial()
        entries = [e for e in entries if e.get("customType") != "beezy-assistance-extraction"]
        args.session.write_text("\n".join(json.dumps(e) for e in entries))
        result = collect(args)
        self.assertFalse(result["valid_trial"])
        self.assertTrue(any("No model-context" in issue for issue in result["trial_issues"]))

    def test_unknown_price_and_changed_fixtures_cannot_claim_savings(self):
        args, entries = self.trial("baseline")
        entries[-1]["message"]["usage"].pop("cost")
        args.session.write_text("\n".join(json.dumps(e) for e in entries))
        result = collect(args)
        self.assertTrue(result["valid_trial"], "missing prices should not prevent a token-only comparison")
        self.assertTrue(result["measurement_notes"])
        self.assertIsNone(result["combined_cost_usd"])
        (self.root / "workspaces/incident/data/events.log").write_text("changed")
        with self.assertRaises(ValueError):
            collect(args)

    def test_report_excludes_mismatched_pairs_and_duplicate_sessions(self):
        args, _ = self.trial("baseline")
        baseline = collect(args)
        args, _ = self.trial("clairic")
        assisted = collect(args)
        assisted["session_key"] = "pi:another-synthetic-test"
        assisted["models"] = ["test/different"]
        stream = io.StringIO()
        with contextlib.redirect_stdout(stream):
            report([baseline, assisted])
        self.assertIn("fully correct pairs: 0", stream.getvalue())
        with self.assertRaises(ValueError):
            with contextlib.redirect_stdout(io.StringIO()):
                report([baseline, baseline])


if __name__ == "__main__":
    unittest.main()
