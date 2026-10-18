"""Synthetic scorer/runner tests only. No fabricated provider runs or quality claims."""

from copy import deepcopy
import json
from pathlib import Path
import subprocess
import sys

import pytest

from evaluations import core
from evaluations.cli import report, save


def mechanics_run():
    run = core.manifest("candidate", "development", "offline")
    labels, _ = core.dataset()
    for c in labels:
        if c["split"] != run["split"]:
            continue
        findings = []
        for f in c["expected_findings"]:
            findings.append(
                {
                    "resource_address": f["resource_address"],
                    "severity": f["minimum_severity"],
                    "evidence": [
                        {
                            "json_path": "$.resource_changes[0].change.after."
                            + f["attribute"]
                        }
                    ],
                    "grounding": {
                        "plan_facts": {f["attribute"]: {}},
                        "interpretation_source": "model",
                        "evidence_ids": f["acceptable_evidence_ids"],
                    },
                }
            )
        run["results"].append(
            {
                "case_id": c["id"],
                "status": "ok",
                "output": {
                    "classification": c["expected_classification"],
                    "findings": findings,
                },
                "latency_ms": 1,
                "estimated_cost_usd": 0,
                "usage": None,
            }
        )
    return run


def test_dataset_has_safe_neighbors_grouped_splits_and_no_label_leakage():
    labels, checksum = core.dataset()
    assert len(labels) == 60 and len(checksum) == 64
    groups = {}
    for c in labels:
        groups.setdefault(c["group"], set()).add(c["split"])
        assert "expected_classification" not in (core.DATA / c["input"]).read_text()
    assert all(len(s) == 1 for s in groups.values())


def test_perfect_mechanics_is_not_live_quality_evidence():
    run = mechanics_run()
    stats = core.score(run)
    assert stats["precision"] == stats["recall"] == stats["f1"] == 1
    result = core.gate(run, run)
    assert result["status"] == "fail" and any(
        "UNEVALUATED" in issue for issue in result["issues"]
    )


@pytest.mark.parametrize("classification", ["safe", "risky"])
def test_constant_reviewers_fail_real_quality_requirements(classification):
    original = mechanics_run()
    constant = deepcopy(original)
    for row in constant["results"]:
        row["output"] = {"classification": classification, "findings": []}
    stats = core.score(constant)
    result = core.gate(constant, original)
    assert result["status"] == "fail"
    if classification == "safe":
        assert (
            stats["counts"]["fn"] > 0
            and stats["critical_misses"]
            and "recall below 0.9" in result["issues"]
        )
    else:
        assert stats["counts"]["fp"] > 0 and "precision below 0.85" in result["issues"]


def test_missing_failed_and_duplicate_cases_never_inflate_scores():
    run = mechanics_run()
    before = core.score(run)
    positive = next(
        r for r in run["results"] if r["output"]["classification"] == "risky"
    )
    run["results"].remove(positive)
    after = core.score(run)
    assert after["coverage"] < 1 and after["counts"]["fn"] == before["counts"]["fn"] + 1
    safe = next(r for r in run["results"] if r["output"]["classification"] == "safe")
    safe["status"] = "execution_error"
    assert core.score(run)["counts"]["fp"] == 1
    run["results"].append(deepcopy(run["results"][0]))
    with pytest.raises(ValueError, match="Duplicate"):
        core.score(run)


def test_incompatible_baseline_and_stale_evidence_fail():
    run = mechanics_run()
    wrong = deepcopy(run)
    wrong["model"] = "another-model"
    with pytest.raises(ValueError, match="model"):
        core.compatible(run, wrong)
    wrong = deepcopy(run)
    wrong["provider"] = "another-provider"
    with pytest.raises(ValueError, match="provider"):
        core.compatible(run, wrong)
    stale = deepcopy(run)
    stale["source_digest"] = "stale"
    assert "UNEVALUATED: stale candidate source" in core.gate(stale, run)["issues"]
    stale = deepcopy(run)
    stale["corpus_digest"] = "stale"
    assert "UNEVALUATED: stale corpus" in core.gate(stale, run)["issues"]


def test_manual_semantics_are_separate_and_bound_to_exact_outputs():
    run = mechanics_run()
    assessments = []
    chosen = [
        row
        for row in run["results"]
        if row["case_id"]
        in {"delete-rds-risk", "rds-unknown-risk", "sg-ssh-risk", "iam-service-risk"}
    ]
    for row in chosen:
        assessments.append(
            {
                "case_id": row["case_id"],
                "result_digest": core.digest(row),
                "reviewer": "test-only fixture",
                "reviewer_kind": "human",
                "notes": "Controlled test, not an actual assessment.",
                "plan_match": True,
                "evidence_relevant": True,
                "recommendation_supported": True,
                "missing_context_acknowledged": True,
            }
        )
    assert core.manual_check(run, {"assessments": assessments}) == []
    assessments[0]["recommendation_supported"] = False
    assert core.manual_check(run, {"assessments": assessments})
    assessments[0]["result_digest"] = "old"
    assert any(
        "stale" in i for i in core.manual_check(run, {"assessments": assessments})
    )


def test_critical_severity_cannot_be_replaced_by_generic_risky_classification():
    run = mechanics_run()
    for row in run["results"]:
        for finding in row["output"]["findings"]:
            if finding["severity"] == "critical":
                finding["severity"] = "high"
    assert core.score(run)["critical_misses"]


def test_zero_denominators_and_report_escaping(tmp_path):
    assert core.ratio(0, 0) == 0 and core.ratio(4, 0) == 0
    run = mechanics_run()
    run["reviewer"] = "<script>bad</script>"
    # Metadata is trusted structured provenance but still must be escaped for a report.
    target = tmp_path / "report.md"
    report(run, target)
    assert "<script>" not in target.read_text()


def test_result_files_and_baseline_promotions_cannot_be_overwritten(tmp_path):
    path = tmp_path / "run.json"
    save(path, {"mode": "offline"})
    with pytest.raises(FileExistsError):
        save(path, {"mode": "live"})
    assert path.stat().st_mode & 0o777 == 0o600


def test_runner_refuses_missing_credentials_and_held_out_without_opt_in(tmp_path):
    for args in [
        ["run", "--reviewer", "candidate", "--mode", "live"],
        ["run", "--reviewer", "candidate", "--split", "held_out"],
    ]:
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "evaluations.cli",
                *args,
                "--out",
                str(tmp_path / "run.json"),
            ],
            capture_output=True,
            text=True,
            cwd=core.ROOT,
            env={"PATH": str(Path(sys.executable).parent)},
        )
        assert result.returncode != 0 and not (tmp_path / "run.json").exists()


def test_replay_preserves_source_and_is_not_a_new_live_run(tmp_path):
    run = mechanics_run()
    source = tmp_path / "source.json"
    save(source, run)
    target = tmp_path / "replay.json"
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "evaluations.cli",
            "replay",
            str(source),
            "--out",
            str(target),
        ],
        capture_output=True,
        text=True,
        cwd=core.ROOT,
    )
    assert result.returncode == 0, result.stderr
    replay = json.loads(target.read_text())
    assert (
        replay["mode"] == "replay" and replay["source_digest"] == run["source_digest"]
    )
    assert replay["replayed_from"]["sha256"] == core.file_digest(source)


def test_saved_hallucinated_references_are_invalid_not_successful():
    run = mechanics_run()
    finding = next(
        row["output"]["findings"][0]
        for row in run["results"]
        if row["output"]["findings"]
    )
    finding["resource_address"] = "aws_instance.invented"
    stats = core.score(run)
    assert stats["counts"]["invalid_outputs"] == 1
    assert stats["counts"]["fn"] == 1


def test_explicit_promotion_preserves_identity_and_rejects_offline(tmp_path):
    from evaluations.cli import read

    run = mechanics_run()
    bad = tmp_path / "promoted.json"
    save(bad, {"promotion": {"run_digest": "old"}, "run": run})
    with pytest.raises(ValueError, match="changed"):
        read(bad)
    source = tmp_path / "source.json"
    save(source, run)
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "evaluations.cli",
            "promote",
            str(source),
            "--out",
            str(tmp_path / "baseline.json"),
            "--reason",
            "test",
        ],
        cwd=core.ROOT,
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0 and not (tmp_path / "baseline.json").exists()


def test_run_file_is_private_before_any_data_is_written(tmp_path, monkeypatch):
    import os

    def inspect_write(value, stream, **kwargs):
        assert os.fstat(stream.fileno()).st_mode & 0o777 == 0o600
        stream.write("{}")

    monkeypatch.setattr(json, "dump", inspect_write)
    save(tmp_path / "private.json", {"mode": "offline"})
