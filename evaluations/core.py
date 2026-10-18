"""Dataset validation, provenance, deterministic scoring and conservative quality gates."""

from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "evaluations/dataset-v1"
MODEL = "gpt-5.4-mini-2026-03-17"
PARAMETERS = {
    "max_input_tokens": 12000,
    "max_output_tokens": 4096,
    "timeout_seconds": 30,
    "max_retries": 0,
    "concurrency": 1,
    "candidate_reasoning_effort": "low",
    "baseline_temperature": 0,
}


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def file_digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def source_digest():
    paths = sorted(
        p
        for p in (ROOT / "apps/api/app").rglob("*")
        if p.is_file() and p.suffix in {".py", ".json"} and "tests" not in p.parts
    )
    paths += [ROOT / "apps/api/requirements.txt"]
    return digest({str(p.relative_to(ROOT)): file_digest(p) for p in paths})


def evaluation_digest():
    return digest(
        {
            p.name: file_digest(p)
            for p in sorted((ROOT / "evaluations").glob("*.py"))
            if p.name != "build_dataset.py"
        }
    )


def dataset(data=DATA):
    labels = json.loads((data / "labels.json").read_text())
    manifest = json.loads((data / "manifest.json").read_text())
    ids = [c["id"] for c in labels]
    if len(labels) < 50 or len(set(ids)) != len(ids):
        raise ValueError("Dataset requires 50+ unique cases")
    groups = defaultdict(set)
    hashes = set()
    files = {}
    evidence_items = {
        item["id"]: item
        for item in json.loads(
            (ROOT / "apps/api/app/policies/evidence-v1.json").read_text()
        )["items"]
    }
    for c in labels:
        if not re.fullmatch(r"[a-z0-9-]{3,80}", c["id"]) or c[
            "expected_severity"
        ] not in {"info", "low", "medium", "high", "critical"}:
            raise ValueError("Invalid case ID/severity")
        if c["dataset_version"] != manifest["version"] or c["split"] not in {
            "development",
            "held_out",
        }:
            raise ValueError("Dataset version/split mismatch")
        if c["expected_classification"] not in {
            "risky",
            "safe",
            "needs_context",
            "invalid",
        }:
            raise ValueError("Invalid label")
        if not c["rationale"] or c["provenance"]["kind"] not in {
            "synthetic",
            "sanitized_real",
        }:
            raise ValueError("Missing label rationale/provenance")
        groups[c["group"]].add(c["split"])
        path = (data / c["input"]).resolve()
        if not path.is_relative_to(data.resolve()):
            raise ValueError("Input outside dataset")
        request = json.loads(path.read_text())
        if set(request) - {"plan", "environment", "policy_profile", "evidence_fixture"}:
            raise ValueError("Labels or unsupported keys in model-visible request")
        if "plan" not in request or request["environment"] not in {
            "prod",
            "dev",
            "staging",
        }:
            raise ValueError("Missing request")
        # Input schema rejection cases are intentional; validate label references structurally here.
        addresses = {
            r.get("address")
            for r in request["plan"].get("resource_changes", [])
            if isinstance(r, dict)
        }
        for f in c["expected_findings"]:
            if f["resource_address"] not in addresses:
                raise ValueError("Expected resource missing")
            if (
                f["minimum_severity"]
                not in {"info", "low", "medium", "high", "critical"}
                or not f["acceptable_evidence_ids"]
                or set(f["acceptable_evidence_ids"]) - evidence_items.keys()
            ):
                raise ValueError("Invalid expected finding severity/evidence")
        fingerprint = digest(request)
        if fingerprint in hashes:
            raise ValueError("Duplicate input content")
        hashes.add(fingerprint)
        files[c["input"]] = file_digest(path)
    if any(len(splits) != 1 for splits in groups.values()):
        raise ValueError("Related variants cross splits")
    if {p.name for p in (data / "inputs").glob("*.json")} != {
        Path(c["input"]).name for c in labels
    }:
        raise ValueError("Missing/unlabeled inputs")
    for split in ("development", "held_out"):
        classes = {c["expected_classification"] for c in labels if c["split"] == split}
        if not {"risky", "safe"} <= classes:
            raise ValueError("Each split needs risky and safe cases")
    return labels, digest({"labels": labels, "manifest": manifest, "inputs": files})


def manifest(reviewer, split, mode, model=MODEL):
    labels, checksum = dataset()
    return {
        "schema": 1,
        "dataset_checksum": checksum,
        "dataset_version": "1.0.0",
        "split": split,
        "mode": mode,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "reviewer": reviewer,
        "provider": "openai" if mode == "live" else "controlled_no_provider",
        "model": model,
        "parameters": PARAMETERS,
        "configuration_digest": digest(
            {"reviewer": reviewer, "model": model, "parameters": PARAMETERS}
        ),
        "source_digest": source_digest()
        if reviewer == "candidate"
        else file_digest(ROOT / "evaluations/baseline/source.tar.gz"),
        "prompt_digest": file_digest(
            ROOT
            / (
                "apps/api/app/services/grounded_review.py"
                if reviewer == "candidate"
                else "evaluations/baseline/source.tar.gz"
            )
        ),
        "corpus_digest": file_digest(ROOT / "apps/api/app/policies/evidence-v1.json")
        if reviewer == "candidate"
        else None,
        "evaluation_digest": evaluation_digest(),
        "expected_case_ids": [c["id"] for c in labels if c["split"] == split],
        "pricing": {
            "input_usd_per_million": 0.75,
            "output_usd_per_million": 4.5,
            "source": "https://developers.openai.com/api/docs/models/gpt-5.4-mini",
            "checked_at": "2026-10-16",
            "kind": "estimate_from_published_rates_no_cache_discount",
        },
        "dependency_versions": {},
        "results": [],
    }


def compatible(a, b):
    fields = (
        "dataset_checksum",
        "split",
        "provider",
        "model",
        "parameters",
        "mode",
        "evaluation_digest",
        "dependency_versions",
    )
    errors = [f"incompatible {key}" for key in fields if a.get(key) != b.get(key)]
    if errors:
        raise ValueError("; ".join(errors))


def ratio(n, d):
    return n / d if d else 0.0


def structural_errors(output, request, reviewer):
    resources = {
        r.get("address"): r
        for r in request["plan"].get("resource_changes", [])
        if isinstance(r, dict)
    }
    docs = {
        d["id"]: d
        for d in json.loads(
            (ROOT / "apps/api/app/policies/evidence-v1.json").read_text()
        )["items"]
    }
    errors = []
    if not isinstance(output.get("findings", []), list):
        return ["invalid findings structure"]
    for finding in output.get("findings", []):
        address = finding.get("resource_address")
        resource = resources.get(address)
        if resource is None:
            if finding.get("source") == "deterministic_rule" and address in {
                None,
                "terraform_plan",
            }:
                continue
            errors.append("nonexistent resource")
            continue
        grounding = finding.get("grounding", {})
        for evidence_id in grounding.get("evidence_ids", []):
            if (
                evidence_id not in docs
                or resource["type"] not in docs[evidence_id]["resource_types"]
            ):
                errors.append("invalid or irrelevant evidence reference")
        change = resource.get("change", {})
        attributes = (
            set(change.get("before") or {})
            | set(change.get("after") or {})
            | {"actions"}
        )
        if isinstance(change.get("after_unknown"), dict):
            attributes.update(change["after_unknown"])
        if set(grounding.get("plan_facts", {})) - attributes:
            errors.append("nonexistent attribute")
    return errors


def score(run):
    labels, checksum = dataset()
    if run.get("dataset_checksum") != checksum:
        raise ValueError("Dataset checksum mismatch")
    if run.get("split") not in {"development", "held_out"}:
        raise ValueError("Invalid run split")
    selected = [c for c in labels if c["split"] == run["split"]]
    if set(run.get("expected_case_ids", [])) != {c["id"] for c in selected} or len(
        run["expected_case_ids"]
    ) != len(selected):
        raise ValueError("Expected cases mismatch")
    rows = run.get("results", [])
    ids = [r["case_id"] for r in rows]
    if len(ids) != len(set(ids)) or set(ids) - set(run["expected_case_ids"]):
        raise ValueError("Duplicate or extra case results")
    by_id = {r["case_id"]: r for r in rows}
    counts = Counter()
    families = defaultdict(Counter)
    details = []
    critical_misses = []
    missing = []
    latencies = []
    costs = []
    usage = Counter()
    expected_findings = matched_findings = model_grounded = 0
    severity_order = {"info": 0, "low": 1, "medium": 2, "high": 3, "critical": 4}
    for case in selected:
        row = by_id.get(case["id"])
        valid = row is not None and row.get("status") == "ok"
        if row is None:
            missing.append(case["id"])
        elif not valid:
            counts["errors"] += 1
            counts["invalid_outputs"] += row.get("status") == "invalid_output"
        if row and isinstance(row.get("latency_ms"), (float, int)):
            latencies.append(row["latency_ms"])
        if row and row.get("estimated_cost_usd") is not None:
            costs.append(row["estimated_cost_usd"])
        if row and row.get("usage"):
            usage.update({k: v for k, v in row["usage"].items() if isinstance(v, int)})
        output = row.get("output", {}) if row else {}
        structural = (
            structural_errors(
                output, json.loads((DATA / case["input"]).read_text()), run["reviewer"]
            )
            if valid
            else []
        )
        if structural:
            valid = False
            counts["invalid_outputs"] += 1
            counts["errors"] += 1
        pred = output.get("classification") if valid else None
        if valid and pred not in {"safe", "risky", "needs_context", "invalid"}:
            valid = False
            pred = None
            counts["invalid_outputs"] += 1
            counts["errors"] += 1
        expected = case["expected_classification"]
        exact = valid and pred == expected
        counts["exact_correct"] += exact
        if expected == "invalid":
            counts["expected_invalid"] += 1
            counts["correct_rejections"] += exact
            category = "input_correct" if exact else "input_failed"
        else:
            positive = expected in {"risky", "needs_context"}
            predicted_positive = pred in {"risky", "needs_context"}
            category = (
                ("tp" if predicted_positive else "fn")
                if positive
                else (
                    "fp"
                    if predicted_positive or not valid or pred == "invalid"
                    else "tn"
                )
            )
            counts[category] += 1
        families[case["family"]][category] += 1
        found = output.get("findings", []) if valid else []
        for expected_finding in case["expected_findings"]:
            expected_findings += 1
            matches = []
            for f in found:
                if f.get("resource_address") != expected_finding["resource_address"]:
                    continue
                paths = [e.get("json_path", "") for e in f.get("evidence", [])]
                facts = f.get("grounding", {}).get("plan_facts", {})
                if expected_finding["attribute"] in facts or any(
                    "." + expected_finding["attribute"] in p for p in paths
                ):
                    matches.append(f)
            adequate = [
                f
                for f in matches
                if severity_order.get(f.get("severity"), -1)
                >= severity_order[expected_finding["minimum_severity"]]
            ]
            matched_findings += bool(adequate)
            model_grounded += any(
                f.get("grounding", {}).get("interpretation_source") == "model"
                and set(f.get("grounding", {}).get("evidence_ids", []))
                & set(expected_finding["acceptable_evidence_ids"])
                for f in adequate
            )
        if case["expected_severity"] == "critical" and not any(
            f.get("severity") == "critical"
            and f.get("resource_address")
            in {e["resource_address"] for e in case["expected_findings"]}
            for f in found
        ):
            critical_misses.append(case["id"])
        details.append(
            {
                "case_id": case["id"],
                "expected": expected,
                "predicted": pred,
                "status": row.get("status") if row else "missing",
                "exact": exact,
                "result_digest": digest(row) if row else None,
            }
        )
    n = len(selected)
    precision = ratio(counts["tp"], counts["tp"] + counts["fp"])
    recall = ratio(counts["tp"], counts["tp"] + counts["fn"])
    counts.update(
        {
            k: 0
            for k in [
                "tp",
                "tn",
                "fp",
                "fn",
                "errors",
                "invalid_outputs",
                "expected_invalid",
                "correct_rejections",
                "exact_correct",
            ]
            if k not in counts
        }
    )
    return {
        "total": n,
        "completed": len(rows),
        "coverage": ratio(len(rows), n),
        "missing": missing,
        "counts": dict(counts),
        "precision": precision,
        "recall": recall,
        "f1": ratio(2 * precision * recall, precision + recall),
        "exact_accuracy": ratio(counts["exact_correct"], n),
        "critical_misses": critical_misses,
        "per_family": {k: dict(v) for k, v in families.items()},
        "cases": details,
        "expected_findings": expected_findings,
        "matched_findings": matched_findings,
        "finding_recall": ratio(matched_findings, expected_findings),
        "model_grounded_findings": model_grounded,
        "model_grounding_coverage": ratio(model_grounded, expected_findings),
        "latency_ms": {
            "measured_cases": len(latencies),
            "mean": sum(latencies) / len(latencies) if latencies else None,
            "max": max(latencies) if latencies else None,
        },
        "usage": dict(usage) or None,
        "estimated_cost_usd": sum(costs) if len(costs) == len(rows) and rows else None,
        "cost_coverage": len(costs),
        "zero_denominator": "All ratios with zero denominator are 0, never perfect.",
    }


def manual_check(run, manual):
    rows = {r["case_id"]: r for r in run["results"]}
    seen = set()
    issues = []
    rubric = (
        "plan_match",
        "evidence_relevant",
        "recommendation_supported",
        "missing_context_acknowledged",
    )
    for item in manual.get("assessments", []):
        id = item.get("case_id")
        if (
            id in seen
            or id not in rows
            or digest(rows[id]) != item.get("result_digest")
        ):
            issues.append("stale/duplicate manual case")
            continue
        seen.add(id)
        if not any(
            f.get("grounding", {}).get("interpretation_source") == "model"
            and f.get("grounding", {}).get("evidence_ids")
            for f in rows[id].get("output", {}).get("findings", [])
        ):
            issues.append(
                "Manual sample must inspect actual model explanations and citations"
            )
        if (
            not item.get("reviewer")
            or item.get("reviewer_kind") != "human"
            or not item.get("notes")
            or any(item.get(k) is not True for k in rubric)
        ):
            issues.append("manual rubric failed or incomplete")
    if len(seen) < 4:
        issues.append("Four inspectable human assessments required")
    labels, _ = dataset()
    selected = [case for case in labels if case["id"] in seen]
    for key, value in [
        ("expected_severity", "critical"),
        ("expected_classification", "needs_context"),
    ]:
        if not any(case[key] == value for case in selected):
            issues.append(f"Manual sample must include {value}")
    return issues


def gate(candidate, baseline, manual=None):
    issues = []
    try:
        compatible(candidate, baseline)
    except ValueError as exc:
        issues.append(str(exc))
    c, b = score(candidate), score(baseline)
    if candidate["mode"] != "live" or baseline["mode"] != "live":
        issues.append("UNEVALUATED: live inference evidence required")
    if candidate["reviewer"] != "candidate":
        issues.append("Candidate reviewer required")
    if baseline.get("reviewer") == "baseline" and baseline.get(
        "source_digest"
    ) != file_digest(ROOT / "evaluations/baseline/source.tar.gz"):
        issues.append("UNEVALUATED: incompatible original baseline source")
    if candidate["source_digest"] != source_digest():
        issues.append("UNEVALUATED: stale candidate source")
    if candidate.get("evaluation_digest") != evaluation_digest():
        issues.append("UNEVALUATED: stale scoring/runner code")
    if candidate.get("corpus_digest") != file_digest(
        ROOT / "apps/api/app/policies/evidence-v1.json"
    ):
        issues.append("UNEVALUATED: stale corpus")
    if candidate.get("prompt_digest") != file_digest(
        ROOT / "apps/api/app/services/grounded_review.py"
    ):
        issues.append("UNEVALUATED: stale prompt")
    if candidate.get("parameters") != PARAMETERS or candidate.get("model") != MODEL:
        issues.append("UNEVALUATED: unsupported inference configuration")
    if candidate.get("configuration_digest") != digest(
        {
            "reviewer": candidate.get("reviewer"),
            "model": candidate.get("model"),
            "parameters": candidate.get("parameters"),
        }
    ):
        issues.append("UNEVALUATED: inference configuration digest mismatch")
    if c["coverage"] != 1 or c["missing"] or c["counts"]["errors"]:
        issues.append("Complete error-free candidate coverage required")
    if b["coverage"] != 1 or b["missing"] or b["counts"]["errors"]:
        issues.append("Complete error-free baseline coverage required")
    if c["counts"]["correct_rejections"] != c["counts"]["expected_invalid"]:
        issues.append("Malformed inputs were not rejected")
    if c["critical_misses"]:
        issues.append(f"Critical misses: {len(c['critical_misses'])}")
    for key, floor in [
        ("precision", 0.85),
        ("recall", 0.90),
        ("f1", 0.87),
        ("exact_accuracy", 0.85),
        ("finding_recall", 0.80),
        ("model_grounding_coverage", 0.60),
    ]:
        if c[key] < floor:
            issues.append(f"{key} below {floor}")
    for key in ("tp", "tn"):
        if c["counts"][key] < b["counts"][key]:
            issues.append(f"Baseline-relative {key} regression")
    for key in ("fp", "fn"):
        if c["counts"][key] > b["counts"][key]:
            issues.append(f"Baseline-relative {key} regression")
    issues += manual_check(candidate, manual or {})
    return {
        "status": "fail" if issues else "pass",
        "issues": issues,
        "candidate": c,
        "baseline": b,
    }
