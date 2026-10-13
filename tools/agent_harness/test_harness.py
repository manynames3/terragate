"""Tests of the harness itself; these do not claim an AI repair succeeded."""
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import run


class HarnessContractTests(unittest.TestCase):
    def test_shipped_cases_have_safe_targets(self):
        cases = run.validated_cases(run.CASES_PATH)
        self.assertEqual(len(cases), 4)
        self.assertEqual(len({item["id"] for item in cases}), len(cases))

    def test_rejects_target_path_traversal(self):
        sample = run.validated_cases(run.CASES_PATH)[0].copy()
        sample["path"] = "apps/api/app/../../../../etc/passwd"
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cases.json"
            path.write_text(json.dumps([sample]), encoding="utf-8")
            with self.assertRaises(ValueError):
                run.validated_cases(path)

    def test_rejects_non_test_command_in_manifest(self):
        sample = run.validated_cases(run.CASES_PATH)[0].copy()
        sample["test"] = "app/tests/hello.py;curl unsafe.example"
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / "cases.json"
            path.write_text(json.dumps([sample]), encoding="utf-8")
            with self.assertRaises(ValueError):
                run.validated_cases(path)

    def test_mutation_requires_one_exact_anchor(self):
        case = run.validated_cases(run.CASES_PATH)[0].copy()
        with tempfile.TemporaryDirectory() as temp:
            workspace = Path(temp)
            target = workspace / case["path"]
            target.parent.mkdir(parents=True)
            target.write_text(case["find"] + "\n", encoding="utf-8")
            run.apply_mutation(workspace, case)
            self.assertIn(case["replace"], target.read_text(encoding="utf-8"))
            with self.assertRaises(ValueError):
                run.apply_mutation(workspace, case)

    def test_restricted_environment_does_not_forward_secrets(self):
        with patch.dict(os.environ, {
            "GITHUB_TOKEN": "should-not-leak",
            "OPENAI_API_KEY": "should-not-leak",
            "AWS_SECRET_ACCESS_KEY": "should-not-leak",
        }):
            env = run.restricted_env()
        self.assertNotIn("GITHUB_TOKEN", env)
        self.assertNotIn("OPENAI_API_KEY", env)
        self.assertNotIn("AWS_SECRET_ACCESS_KEY", env)

    def test_subprocess_timeout_is_bounded(self):
        with tempfile.TemporaryDirectory() as temp:
            result = run.execute(
                [sys.executable, "-c", "import time; time.sleep(10)"], Path(temp), 1
            )
        self.assertEqual(result["exit"], 124)
        self.assertTrue(result["timed_out"])

    def test_summary_labels_synthetic_runs(self):
        report = {
            "created_at": "2026-10-13T00:00:00+00:00", "base_sha": "abc",
            "agent": "fixture", "variant": "guided", "model": "synthetic",
            "synthetic": True,
            "results": [{
                "case": "redaction-marker", "iteration": 1, "baseline_red": True,
                "success": True, "attempts": [{}], "elapsed_seconds": 2.0,
                "reason": "verified_repair",
            }],
        }
        summary = run.summarize(report)
        self.assertIn("SYNTHETIC harness smoke test, not AI performance", summary)
        self.assertIn("1/1 (100.0%)", summary)


if __name__ == "__main__":
    unittest.main()
