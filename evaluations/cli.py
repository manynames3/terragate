"""python -m evaluations.cli --help (all commands default to no paid calls)."""

import argparse
from copy import deepcopy
from html import escape
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
from time import monotonic

from evaluations.core import (
    DATA,
    MODEL,
    ROOT,
    compatible,
    dataset,
    digest,
    file_digest,
    gate,
    manifest,
    score,
)


def read(path):
    value = json.loads(Path(path).read_text())
    if "promotion" in value and digest(value.get("run")) != value["promotion"].get(
        "run_digest"
    ):
        raise ValueError("Promoted baseline contents changed")
    return value["run"] if "run" in value and "promotion" in value else value


def save(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    # Runs/promotions are immutable. An interrupted run is saved by the runner in its finally block.
    with os.fdopen(
        os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w"
    ) as stream:
        json.dump(value, stream, indent=2)
        stream.write("\n")


def infer(args):
    if args.split == "held_out" and not args.allow_held_out:
        raise ValueError(
            "Held-out inference requires --allow-held-out; do not tune against its results"
        )
    if args.mode == "live" and (not args.allow_live or not os.getenv("OPENAI_API_KEY")):
        raise ValueError(
            "Live mode requires --allow-live and OPENAI_API_KEY; no mock substitution"
        )
    labels, _ = dataset()
    selected = [c for c in labels if c["split"] == args.split]
    calls_per_case = 4 if args.reviewer == "baseline" else 1
    max_calls = len(selected) * calls_per_case
    bound = max_calls * (12000 * 0.75 + 4096 * 4.5) / 1_000_000
    if args.mode == "live" and args.budget_usd < bound:
        raise ValueError(
            f"Conservative published-rate estimate is ${bound:.2f}; supplied budget is too small"
        )
    if Path(args.out).exists():
        raise ValueError("Output exists; choose a fresh run name")
    run = manifest(args.reviewer, args.split, args.mode, args.model)
    run["limits"] = {
        "max_calls": max_calls,
        "max_seconds": args.max_seconds,
        "estimated_upper_cost_usd": bound if args.mode == "live" else 0.0,
    }
    start = monotonic()
    with tempfile.TemporaryDirectory(prefix="terragate-eval-") as tmp:
        app_path = ROOT / "apps/api"
        if args.reviewer == "baseline":
            archive = ROOT / "evaluations/baseline/source.tar.gz"
            original = json.loads(
                (ROOT / "evaluations/baseline/manifest.json").read_text()
            )
            if file_digest(archive) != original["source_sha256"]:
                raise ValueError("Frozen baseline source was changed")
            with tarfile.open(archive) as source:
                source.extractall(tmp, filter="data")
            app_path = Path(tmp) / "apps/api"
        env = {
            k: v
            for k, v in os.environ.items()
            if k in {"PATH", "HOME", "SYSTEMROOT", "SSL_CERT_FILE", "SSL_CERT_DIR"}
        }
        env.update(
            {
                "PYTHONPATH": str(app_path),
                "OPENAI_MODEL": args.model,
                "REVIEWER_VERSION": "grounded-v2"
                if args.reviewer == "candidate"
                else "legacy-v1",
                "LANGSMITH_TRACING": "false",
                "LANGCHAIN_TRACING_V2": "false",
                "GITHUB_TOKEN": "",
                "INFRACOST_API_KEY": "",
                "PUBLIC_DEMO_MODE": "true",
                "OPENAI_API_KEY": os.getenv("OPENAI_API_KEY", "")
                if args.mode == "live"
                else "",
            }
        )
        try:
            for case in selected[: args.limit]:
                if monotonic() - start >= args.max_seconds:
                    run["stop_reason"] = "time_budget"
                    break
                request = json.loads(
                    (DATA / case["input"]).read_text()
                )  # Only this input, never labels, reaches the worker.
                try:
                    process = subprocess.run(
                        [
                            sys.executable,
                            str(ROOT / "evaluations/worker.py"),
                            args.mode,
                            args.reviewer,
                        ],
                        input=json.dumps(request),
                        text=True,
                        capture_output=True,
                        cwd=tmp,
                        env=env,
                        timeout=min(
                            135 if args.reviewer == "baseline" else 45,
                            args.max_seconds - (monotonic() - start),
                        ),
                    )
                    if process.returncode:
                        raise RuntimeError("worker_error")
                    row = json.loads(process.stdout)
                    run["dependency_versions"] = row.pop("dependency_versions", {})
                except (
                    subprocess.TimeoutExpired,
                    RuntimeError,
                    json.JSONDecodeError,
                ) as exc:
                    row = {
                        "status": "execution_error",
                        "error_type": type(exc).__name__,
                        "output": {},
                        "latency_ms": None,
                        "usage": None,
                        "estimated_cost_usd": None,
                    }
                row["case_id"] = case["id"]
                run["results"].append(row)
                print(
                    f"{len(run['results'])}/{len(selected)} {case['id']}: {row['status']}",
                    flush=True,
                )
        except KeyboardInterrupt:
            run["stop_reason"] = "cancelled"
        finally:
            run["elapsed_ms"] = round((monotonic() - start) * 1000, 2)
            save(args.out, run)
    return run


def report(run, path):
    stats = score(run)

    def plain(value):
        return (
            escape(str(value))
            .replace("|", "&#124;")
            .replace("\n", " ")
            .replace("`", "&#96;")
            .replace("[", "&#91;")
            .replace("]", "&#93;")
        )

    text = [
        "# TerraGate evaluation",
        "",
        f"Mode: **{plain(run['mode'])}**; reviewer: **{plain(run['reviewer'])}**; split: **{plain(run['split'])}**.",
        "Offline controlled responses establish mechanics/rule behavior only. Replay is historical evidence. Neither is a live quality verdict.",
        "",
        f"Dataset checksum: `{plain(run['dataset_checksum'])}`",
        f"Reviewer source: `{plain(run['source_digest'])}`",
        "",
        f"Coverage: {stats['completed']}/{stats['total']}; errors: {stats['counts']['errors']}; critical misses: {len(stats['critical_misses'])}.",
        f"TP {stats['counts']['tp']} · TN {stats['counts']['tn']} · FP {stats['counts']['fp']} · FN {stats['counts']['fn']}",
        f"Precision {stats['precision']:.3f} · Recall {stats['recall']:.3f} · F1 {stats['f1']:.3f}",
        f"Expected findings matched: {stats['matched_findings']}/{stats['expected_findings']}. Model-grounded: {stats['model_grounded_findings']}/{stats['expected_findings']}.",
        "",
        f"Latency (measured worker/graph, ms): {stats['latency_ms']}",
        f"Usage returned by provider: {stats['usage']}",
        f"Estimated USD from returned token usage: {stats['estimated_cost_usd']} ({stats['cost_coverage']}/{stats['completed']} cases). Billing was not measured.",
        "",
        "Small-sample differences are counts, not statistically established improvements. Labels are authored by the project.",
        "",
        "| Scenario | Counts |",
        "| --- | --- |",
    ]
    text += [
        f"| {plain(family)} | {plain(counts)} |"
        for family, counts in stats["per_family"].items()
    ]
    text += [
        "",
        "| Case | Expected | Predicted | Status |",
        "| --- | --- | --- | --- |",
    ]
    text += [
        "| "
        + " | ".join(
            plain(row[k]) for k in ["case_id", "expected", "predicted", "status"]
        )
        + " |"
        for row in stats["cases"]
    ]
    text += [
        "",
        "## Explanation inspection",
        "Findings and references are in the saved JSON. Use the four-question human rubric; structural validity does not prove semantic support.",
    ]
    # No untrusted plan/model prose is interpolated into executable HTML.
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("\n".join(text) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("validate")
    p = sub.add_parser("run")
    p.add_argument("--reviewer", choices=["baseline", "candidate"], required=True)
    p.add_argument("--mode", choices=["offline", "live"], default="offline")
    p.add_argument(
        "--split", choices=["development", "held_out"], default="development"
    )
    p.add_argument("--allow-held-out", action="store_true")
    p.add_argument("--allow-live", action="store_true")
    p.add_argument("--model", choices=[MODEL], default=MODEL)
    p.add_argument("--budget-usd", type=float, default=0)
    p.add_argument("--limit", type=int, default=60)
    p.add_argument("--max-seconds", type=int, default=900)
    p.add_argument("--out", required=True)
    for name in ("score", "report", "replay", "promote", "manual-template"):
        p = sub.add_parser(name)
        p.add_argument("run")
        if name != "score":
            p.add_argument("--out", required=True)
        if name == "promote":
            p.add_argument("--reason", required=True)
    p = sub.add_parser("compare")
    p.add_argument("baseline")
    p.add_argument("candidate")
    p = sub.add_parser("gate")
    p.add_argument("--baseline", required=True)
    p.add_argument("--candidate", required=True)
    p.add_argument("--manual")
    p.add_argument("--out")
    args = parser.parse_args()
    try:
        if args.command == "validate":
            labels, checksum = dataset()
            print(
                json.dumps(
                    {
                        "cases": len(labels),
                        "checksum": checksum,
                        "split_counts": dict(
                            __import__("collections").Counter(
                                c["split"] for c in labels
                            )
                        ),
                    },
                    indent=2,
                )
            )
        elif args.command == "run":
            if not 1 <= args.limit <= 60 or not 1 <= args.max_seconds <= 3600:
                raise ValueError("Run limit/time out of bounds")
            infer(args)
        elif args.command == "score":
            print(json.dumps(score(read(args.run)), indent=2))
        elif args.command == "report":
            report(read(args.run), args.out)
        elif args.command == "replay":
            run = deepcopy(read(args.run))
            run["replayed_from"] = {
                "sha256": file_digest(args.run),
                "original_mode": run["mode"],
                "original_timestamp": run["timestamp"],
            }
            run["mode"] = "replay"
            save(args.out, run)
        elif args.command == "promote":
            run = read(args.run)
            stats = score(run)
            if (
                run["mode"] != "live"
                or stats["coverage"] != 1
                or stats["counts"]["errors"]
            ):
                raise ValueError("Only complete error-free live runs can be promoted")
            save(
                args.out,
                {
                    "promotion": {
                        "reason": args.reason,
                        "source_sha256": file_digest(args.run),
                        "run_digest": digest(run),
                    },
                    "run": run,
                },
            )
        elif args.command == "manual-template":
            run = read(args.run)
            rows = [
                r
                for r in run["results"]
                if any(
                    f.get("grounding", {}).get("interpretation_source") == "model"
                    for f in r.get("output", {}).get("findings", [])
                )
            ]
            labels, _ = dataset()
            by_id = {case["id"]: case for case in labels}
            prioritized = []
            for key, value in [
                ("expected_severity", "critical"),
                ("expected_classification", "needs_context"),
            ]:
                match = next(
                    (row for row in rows if by_id[row["case_id"]][key] == value), None
                )
                if match and match not in prioritized:
                    prioritized.append(match)
            rows = prioritized + [row for row in rows if row not in prioritized]
            save(
                args.out,
                {
                    "assessments": [
                        {
                            "case_id": r["case_id"],
                            "result_digest": digest(r),
                            "reviewer": "",
                            "reviewer_kind": "human",
                            "plan_match": None,
                            "evidence_relevant": None,
                            "recommendation_supported": None,
                            "missing_context_acknowledged": None,
                            "notes": "",
                        }
                        for r in rows[:6]
                    ]
                },
            )
        elif args.command == "compare":
            a, b = read(args.baseline), read(args.candidate)
            compatible(a, b)
            x, y = score(a), score(b)
            print(
                json.dumps(
                    {
                        "baseline": x,
                        "candidate": y,
                        "count_deltas": {
                            k: y["counts"][k] - x["counts"][k]
                            for k in ["tp", "tn", "fp", "fn"]
                        },
                        "interpretation": "Changes include rules, prompt, retrieval, validation and settings; no isolated causal attribution.",
                    },
                    indent=2,
                )
            )
        elif args.command == "gate":
            if not Path(args.candidate).exists() or not Path(args.baseline).exists():
                result = {
                    "status": "unevaluated",
                    "issues": [
                        "Missing compatible live baseline/candidate evidence. Offline tests are not model-quality evidence."
                    ],
                }
            else:
                result = gate(
                    read(args.candidate),
                    read(args.baseline),
                    json.loads(Path(args.manual).read_text())
                    if args.manual and Path(args.manual).exists()
                    else None,
                )
            if args.out:
                Path(args.out).parent.mkdir(parents=True, exist_ok=True)
                Path(args.out).write_text(json.dumps(result, indent=2) + "\n")
            print(json.dumps(result, indent=2))
            return 0 if result["status"] == "pass" else 1
    except (ValueError, KeyError, OSError, tarfile.TarError) as exc:
        print(f"UNEVALUATED/ERROR: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
