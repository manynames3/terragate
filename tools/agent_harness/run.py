#!/usr/bin/env python3
"""Reproducible, local coding-agent repair evaluations for TerraGate.

Stdlib orchestration; real repairs use the user's authenticated Codex CLI.
This is a working-tree harness, not a hardened operating-system sandbox.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import statistics
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
CASES_PATH = Path(__file__).with_name("cases.json")
ID_PATTERN = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*\Z")
KEEP_ENV = {
    "HOME", "PATH", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "TERM", "TMPDIR",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME", "CODEX_HOME",
    "SSL_CERT_FILE", "SSL_CERT_DIR", "SYSTEMROOT", "WINDIR",
}


def utcnow() -> str:
    return datetime.now(timezone.utc).isoformat()


def restricted_env() -> dict[str, str]:
    """Don't forward cloud, SCM, or vendor API credentials into child processes."""
    return {key: value for key, value in os.environ.items() if key in KEEP_ENV}


def validated_cases(path: Path) -> list[dict]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or not raw:
        raise ValueError("Cases must be a nonempty JSON array.")
    seen = set()
    for case in raw:
        if not isinstance(case, dict) or not all(
            isinstance(case.get(key), str) and case[key]
            for key in ("id", "path", "find", "replace", "test", "prompt")
        ):
            raise ValueError("Each case needs nonempty id, path, find, replace, test and prompt.")
        case_id = case["id"]
        if not ID_PATTERN.fullmatch(case_id) or case_id in seen:
            raise ValueError(f"Invalid or duplicate case ID: {case_id}")
        seen.add(case_id)
        target = PurePosixPath(case["path"])
        if target.is_absolute() or ".." in target.parts or not case["path"].startswith("apps/api/app/"):
            raise ValueError(f"Unsafe mutation target: {case['path']}")
        if case["find"] == case["replace"]:
            raise ValueError(f"Case does not change code: {case_id}")
        test = case["test"]
        if not test.startswith("app/tests/") or any(char.isspace() for char in test):
            raise ValueError(f"Test must be an explicit app/tests node ID: {test}")
    return raw


def execute(args: list[str], cwd: Path, timeout: int, *, stdin: str | None = None,
            env: dict[str, str] | None = None) -> dict:
    """Never use a shell; kill the subprocess group on timeout."""
    start = time.monotonic()
    try:
        process = subprocess.Popen(
            args, cwd=str(cwd), env=env or restricted_env(),
            stdin=subprocess.PIPE if stdin is not None else subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
            start_new_session=(os.name == "posix"),
        )
    except OSError as error:
        return {"exit": 127, "seconds": round(time.monotonic() - start, 3),
                "output": f"Could not start {args[0]}: {error}", "timed_out": False}
    timed_out = False
    try:
        output, _ = process.communicate(input=stdin, timeout=timeout)
    except subprocess.TimeoutExpired:
        timed_out = True
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGKILL)
        else:
            process.kill()
        output, _ = process.communicate()
    return {"exit": 124 if timed_out else process.returncode,
            "seconds": round(time.monotonic() - start, 3),
            "output": (output or "")[-6000:], "timed_out": timed_out}


def git(root: Path, *args: str) -> str:
    result = execute(["git", *args], root, 30)
    if result["exit"]:
        raise RuntimeError(f"git {' '.join(args)} failed: {result['output']}")
    return result["output"].strip()


def changed_paths(worktree: Path) -> list[str]:
    tracked = git(worktree, "diff", "--name-only").splitlines()
    staged = git(worktree, "diff", "--cached", "--name-only").splitlines()
    untracked = git(worktree, "ls-files", "--others", "--exclude-standard").splitlines()
    return sorted(set(tracked + staged + untracked))


def apply_mutation(worktree: Path, case: dict) -> None:
    path = worktree / case["path"]
    if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(worktree.resolve()):
        raise ValueError(f"Unsafe or missing mutation file: {case['path']}")
    data = path.read_text(encoding="utf-8")
    if data.count(case["find"]) != 1:
        raise ValueError(f"Expected exactly one mutation anchor in {case['path']}")
    path.write_text(data.replace(case["find"], case["replace"], 1), encoding="utf-8")


def verify(worktree: Path, case: dict, timeout: int) -> dict:
    return execute(
        [sys.executable, "-m", "pytest", "-q", case["test"]],
        worktree / "apps" / "api", timeout,
    )


def instruction(case: dict, guided: bool, previous: str) -> str:
    parts = [
        "A controlled regression was introduced in a disposable TerraGate worktree.",
        case["prompt"],
        f"Only modify {case['path']}. Do not change or disable tests.",
        "Do not commit, push, modify remote repositories, deploy, or access secrets.",
        "Return the existing behavior, not a workaround that relaxes the requirement.",
    ]
    if guided:
        parts.extend([
            "Read AGENTS.md and docs/agent-harness.md as the repository contracts.",
            "Respect deterministic-first policy checks, secret redaction, and approval boundaries.",
            f"Run the focused verifier from apps/api: python -m pytest -q {case['test']}.",
            "Inspect failure output and fix the root cause before finishing.",
        ])
    if previous:
        parts.append("Previous verifier failure (trimmed):\n" + previous[-2500:])
    return "\n\n".join(parts)


def run_case(case: dict, base_sha: str, args: argparse.Namespace, iteration: int) -> dict:
    started = time.monotonic()
    result = {
        "case": case["id"], "iteration": iteration, "base_sha": base_sha,
        "agent": args.agent, "variant": args.variant, "model": args.model or "CLI default / not recorded",
        "started_at": utcnow(), "baseline_red": False, "success": False,
        "attempts": [], "reason": "", "synthetic": args.agent == "fixture",
    }
    with tempfile.TemporaryDirectory(prefix="terragate-harness-") as temp_dir:
        worktree = Path(temp_dir) / "repo"
        try:
            git(ROOT, "worktree", "add", "--quiet", "--detach", str(worktree), base_sha)
            apply_mutation(worktree, case)
            baseline = verify(worktree, case, args.verify_timeout)
            result["baseline_red"] = baseline["exit"] != 0 and not baseline["timed_out"]
            if not result["baseline_red"]:
                result["reason"] = "invalid_baseline: injected regression did not fail a runnable test"
                return result

            previous = ""
            for attempt in range(1, args.attempts + 1):
                if args.agent == "fixture":
                    # Synthetic control validates pipeline mechanics. NOT an AI repair.
                    path = worktree / case["path"]
                    data = path.read_text(encoding="utf-8")
                    if data.count(case["replace"]) != 1:
                        raise RuntimeError("Synthetic repair mutation not uniquely present")
                    path.write_text(data.replace(case["replace"], case["find"], 1), encoding="utf-8")
                    agent_run = {"exit": 0, "seconds": 0, "output": "", "timed_out": False}
                else:
                    command = ["codex", "exec", "--sandbox", "workspace-write",
                               "--ask-for-approval", "never"]
                    if args.model:
                        command.extend(["--model", args.model])
                    command.append("-")
                    agent_run = execute(
                        command, worktree, args.timeout,
                        stdin=instruction(case, args.variant == "guided", previous),
                    )

                edits = changed_paths(worktree)
                head_changed = git(worktree, "rev-parse", "HEAD") != base_sha
                unexpected = sorted(set(edits) - {case["path"]})
                record = {
                    "number": attempt, "agent_exit": agent_run["exit"],
                    "agent_seconds": agent_run["seconds"], "agent_timeout": agent_run["timed_out"],
                    "changed_paths": edits, "unexpected_paths": unexpected,
                    "head_changed": head_changed,
                }
                if head_changed or unexpected:
                    record["verification_exit"] = None
                    result["attempts"].append(record)
                    result["reason"] = "unauthorized_change: committed or edited outside the allowed file"
                    break
                check = verify(worktree, case, args.verify_timeout)
                record["verification_exit"] = check["exit"]
                record["verification_seconds"] = check["seconds"]
                record["verification_timeout"] = check["timed_out"]
                result["attempts"].append(record)
                if check["exit"] == 0 and not check["timed_out"] and agent_run["exit"] == 0:
                    result["success"] = True
                    result["reason"] = "verified_repair"
                    break
                previous = check["output"]
                result["reason"] = "verification_failed" if not check["timed_out"] else "verification_timeout"
                if agent_run["exit"] != 0:
                    result["reason"] = "agent_failed_or_timed_out"
                    break
        except (OSError, ValueError, RuntimeError) as error:
            result["reason"] = f"harness_error: {error}"
        finally:
            if worktree.exists():
                execute(["git", "worktree", "remove", "--force", str(worktree)], ROOT, 30)
            result["elapsed_seconds"] = round(time.monotonic() - started, 3)
    return result


def summarize(report: dict) -> str:
    results = report["results"]
    passed = sum(result["success"] for result in results)
    baseline_red = sum(result["baseline_red"] for result in results)
    rate = 100 * passed / len(results) if results else 0
    elapsed = [result["elapsed_seconds"] for result in results]
    lines = [
        "# TerraGate agent harness evaluation",
        "",
        f"- Timestamp: {report['created_at']}",
        f"- Commit: {report['base_sha']}",
        f"- Agent: {report['agent']}",
        f"- Variant: {report['variant']}",
        f"- Model: {report['model']}",
        f"- Provenance: {'SYNTHETIC harness smoke test, not AI performance' if report['synthetic'] else 'Real Codex CLI run; inspect configuration and GitHub evidence'}",
        f"- Cases: {len(results)}",
        f"- Confirmed red baselines: {baseline_red}/{len(results)}",
        f"- Verified repairs: {passed}/{len(results)} ({rate:.1f}%)",
        f"- Median elapsed: {statistics.median(elapsed):.2f}s" if elapsed else "- Median elapsed: N/A",
        "",
        "| Case | Red baseline | Fixed | Attempts | Seconds | Outcome |",
        "| --- | --- | --- | ---: | ---: | --- |",
    ]
    for item in results:
        lines.append(
            f"| {item['case']} #{item['iteration']} | {item['baseline_red']} | "
            f"{item['success']} | {len(item['attempts'])} | {item['elapsed_seconds']:.2f} | {item['reason']} |"
        )
    lines.extend(["", "These tests demonstrate focused repair behavior only. They do not "
                  "validate production deployments, business outcomes, or host-level isolation.", ""])
    return "\n".join(lines)


def run(args: argparse.Namespace) -> int:
    all_cases = validated_cases(CASES_PATH)
    cases = all_cases if args.case == "all" else [c for c in all_cases if c["id"] == args.case]
    if not cases:
        raise ValueError("Unknown case ID")
    if args.agent == "codex" and not shutil.which("codex"):
        raise RuntimeError("Codex CLI not installed. Install/login with your subscription; no API key is required.")
    base_sha = git(ROOT, "rev-parse", "HEAD")
    report = {
        "schema_version": 1, "created_at": utcnow(), "base_sha": base_sha,
        "agent": args.agent, "variant": args.variant,
        "model": args.model or "CLI default / not recorded",
        "synthetic": args.agent == "fixture", "results": [],
    }
    for case in cases:
        for iteration in range(1, args.repeats + 1):
            item = run_case(case, base_sha, args, iteration)
            report["results"].append(item)
            print(f"{item['case']} #{iteration}: {'PASS' if item['success'] else 'FAIL'} ({item['reason']})",
                  flush=True)
    output = Path(args.output).expanduser().resolve()
    output.mkdir(parents=True, exist_ok=True)
    (output / "results.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    (output / "summary.md").write_text(summarize(report), encoding="utf-8")
    print(f"Evidence: {output / 'summary.md'}")
    return 0 if all(item["success"] for item in report["results"]) else 1


def compare(args: argparse.Namespace) -> int:
    left = json.loads(Path(args.left).read_text(encoding="utf-8"))
    right = json.loads(Path(args.right).read_text(encoding="utf-8"))
    if left["synthetic"] or right["synthetic"]:
        raise ValueError("Synthetic fixture reports are not valid for real-agent improvement claims.")
    if left["base_sha"] != right["base_sha"]:
        raise ValueError("Compare only reports from the same source commit.")
    for report in (left, right):
        if report["agent"] != "codex":
            raise ValueError("Only like-for-like real Codex runs may be compared here.")
    matrix = lambda r: sorted((x["case"], x["iteration"]) for x in r["results"])
    if matrix(left) != matrix(right):
        raise ValueError("Reports must contain identical cases and repetition counts.")
    left_rate = sum(x["success"] for x in left["results"]) / len(left["results"])
    right_rate = sum(x["success"] for x in right["results"]) / len(right["results"])
    print(f"Source commit: {left['base_sha']}")
    print(f"First: {left['variant']} {left['model']}: {left_rate:.1%}")
    print(f"Second: {right['variant']} {right['model']}: {right_rate:.1%}")
    print(f"Difference: {(right_rate - left_rate) * 100:+.1f} percentage points")
    print("Observational evaluation only: small samples do not establish causal improvement.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="TerraGate agent harness evaluation")
    sub = parser.add_subparsers(dest="command", required=True)
    r = sub.add_parser("run", help="Run isolated repairs and save evidence")
    r.add_argument("--agent", choices=("fixture", "codex"), default="fixture")
    r.add_argument("--case", default="all")
    r.add_argument("--variant", choices=("basic", "guided"), default="guided")
    r.add_argument("--model", default=None, help="Codex model name; omit to use CLI config")
    r.add_argument("--attempts", type=int, default=2)
    r.add_argument("--repeats", type=int, default=1)
    r.add_argument("--timeout", type=int, default=600)
    r.add_argument("--verify-timeout", type=int, default=90)
    r.add_argument("--output", default="agent-harness-results")
    c = sub.add_parser("compare", help="Compare two real-agent evidence JSON files")
    c.add_argument("left")
    c.add_argument("right")
    args = parser.parse_args()
    if args.command == "run":
        if not (1 <= args.attempts <= 3 and 1 <= args.repeats <= 10):
            parser.error("attempts must be 1-3 and repeats must be 1-10")
        if not (10 <= args.timeout <= 3600 and 10 <= args.verify_timeout <= 1200):
            parser.error("timeout settings are outside safe bounds")
        return run(args)
    return compare(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError, OSError, KeyError) as exc:
        print(f"Harness failed: {exc}", file=sys.stderr)
        sys.exit(2)
