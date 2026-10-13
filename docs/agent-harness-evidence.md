# Agent Harness Evidence Ledger

**Last edited:** October 13, 2026.

This ledger is intentionally conservative: code, unit tests, synthetic pipeline tests, and real coding-agent evaluations are different kinds of evidence.

## Source-controlled artifacts

| Claim | Verifiable source | Status |
| --- | --- | --- |
| Agent context map and non-negotiable rules | [AGENTS.md](../AGENTS.md) | Implemented in harness PR |
| Reproducible target regressions | [cases.json](../tools/agent_harness/cases.json) | Four versioned scenarios |
| Disposable worktree, green/red/green, retry, file boundary, results | [run.py](../tools/agent_harness/run.py) | Implemented; [synthetic CI passed](https://github.com/manynames3/terragate/actions/runs/38369770486) |
| Safety and report unit tests | [test_harness.py](../tools/agent_harness/test_harness.py) | Implemented; CI verification required |
| No-credit fixture pipeline in GitHub Actions | [agent-harness.yml](../.github/workflows/agent-harness.yml) | [Synthetic CI passed](https://github.com/manynames3/terragate/actions/runs/38369770486); not real AI |
| Live repair rate, cost/time improvement, multiple models | None yet | **Not measured** |
| Hardened sandbox or live Kubernetes orchestration | None in this harness | **Not implemented** |

## Verified CI checkpoint

On October 13, 2026, the [Agent Harness Evidence workflow](https://github.com/manynames3/terragate/actions/runs/38369770486) and [existing product CI](https://github.com/manynames3/terragate/actions/runs/38369770447) both completed successfully for source commit 1faa0e4463220610407c9b8b7c90e4d7b75ddd8f.

**Interpretation:** this verifies harness unit tests and a four-case deterministic fixture-mode red/green repair pipeline. No real Codex benchmark has been completed or scored.

## How to verify independently

1. Open [Agent Harness Evidence workflow](https://github.com/manynames3/terragate/actions/workflows/agent-harness.yml) and select the commit under review.
2. Confirm the harness unit tests are green and download the artifact named **agent-harness-synthetic-control**.
3. Review results.json: every synthetic case should show green control, failing injected test, fixed result, and no unauthorized changes.
4. Note that the fixture mode makes no AI calls and represents **zero real agent task completions**.
5. For an actual evaluation, run the authenticated local CLI instructions in [agent-harness.md](agent-harness.md), and independently preserve the exact CLI/model version, SHA, case matrix, and artifacts before editing this ledger.

## Live-agent benchmark record

No completed, audited Codex evaluation has been attached to this ledger as of this edit. Do not publish performance percentages until a real benchmark is run and artifacts have been checked.

When available, append rows using this schema:

| Date (UTC) | Commit SHA | Agent + version/model | Variant | Cases × repeats | Pass@1 | Pass≤2 | Timeouts | Unsafe edits | Evidence URL |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |

Use actual denominator counts and attach failure examples. Compare basic and guided only when sample matrix, commit, model, and environment are identical; the harness is a small benchmark and does not independently prove causality.

## Current fair resume description

**Engineering work sample (after PR and CI validation):**

> Designed a reproducible coding-agent harness for Terraform-review code, using isolated Git worktrees, controlled fault injection, gated verification, bounded repair loops and machine-readable evaluation results.

**Only after real runs:** describe the observed pass rates and improvement, if any. Never turn synthetic pipeline successes into model-performance statistics.
