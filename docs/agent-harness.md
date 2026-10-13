# Coding-Agent Harness: Controlled Repair Evaluations

**Status (October 13, 2026):** harness implementation and CI contract tests. Real coding-agent performance is **not established** by the synthetic CI run. See [the evidence ledger](agent-harness-evidence.md).

## Purpose and method

TerraGate already has a LangGraph-powered Terraform review workflow with deterministic policy checks and human approval boundaries. This additional **coding-agent harness** tests whether a real Codex CLI agent can repair genuine TerraGate regressions repeatedly. It is separate from the application's LangGraph runtime.

Each repeatable evaluation:

1. Creates a disposable detached Git worktree pinned to an exact commit.
2. Confirms the focused test passes *before injection*, introduces a controlled mutation, and confirms the test now fails.
3. Runs Codex with bounded attempts, supplying focused verifier output after a failed repair.
4. Rejects edits outside the permitted source file or any new commit, runs the focused test and cross-module regression suite, saves evidence, and removes the worktree.

~~~mermaid
flowchart TD
    A[Versioned case and Git SHA] --> B[Temporary worktree]
    B --> C[Control test green]
    C --> D[Fault injection]
    D --> E[Test red]
    E --> F{Executor}
    F -->|fixture| G[Synthetic repair for CI]
    F -->|codex| H[Authenticated Codex CLI]
    G --> I[File and commit guard]
    H --> I
    I --> J[Focused and regression pytest]
    J --> K{Pass?}
    K -->|Retry with feedback| H
    K -->|Pass or attempts exhausted| L[JSON and Markdown evidence]
~~~

Four versioned scenarios are based on real TerraGate code and existing tests.

| Case | Injected fault | Required behavior |
| --- | --- | --- |
| redaction-marker | Corrupt redaction marker | Secret values have the correct masked representation |
| redaction-key-detection | Stop matching password-like keys | Plan password fields are redacted |
| public-rds-detection | Invert public RDS exposure predicate | Public RDS instance creates a security finding |
| critical-risk-classification | Break severity threshold | High and critical risk remain correctly classified |

Manifest: [cases.json](../tools/agent_harness/cases.json). Implementation: [run.py](../tools/agent_harness/run.py).

## Run the no-credit harness smoke test

From the repo root:

~~~sh
python -m pip install -r apps/api/requirements.txt
python -m unittest discover -s tools/agent_harness -p 'test_*.py' -v
python tools/agent_harness/run.py run \
  --agent fixture --case all --attempts 1 \
  --output agent-harness-results/synthetic
~~~

The fixture adapter restores the mutated text deterministically. **It is not an AI run and must never be represented as an AI success rate.** This checks the harness machinery only.

## Real Codex evaluation with your subscription

Authenticate the installed Codex CLI with your existing ChatGPT subscription; no OpenAI API key is required by this harness.

~~~sh
codex login
python tools/agent_harness/run.py run \
  --agent codex --variant guided \
  --case all --attempts 2 --repeats 3 \
  --output agent-harness-results/guided
~~~

To assess the effect of additional harness instructions on the *same source SHA, model, CLI version and environment*:

~~~sh
python tools/agent_harness/run.py run \
  --agent codex --variant basic \
  --case all --attempts 2 --repeats 3 \
  --output agent-harness-results/basic

python tools/agent_harness/run.py compare \
  agent-harness-results/basic/results.json \
  agent-harness-results/guided/results.json
~~~

Both variants can see the repo's AGENTS.md; the variable is *additional explicit guidance*, not complete absence of context. Use an explicit --model for model-specific claims. The report labels unspecified models as unverified CLI defaults. CLI subscriptions may have usage limits.

## What to measure and report

For each variant, publish the exact Git SHA, CLI version, model, number of independent attempts, pass@1, pass within bounded retries, unauthorized file changes, timeout rate, and duration distribution. Count failed attempts honestly and retain reproducible cases. Four cases with three repeats each form a small **pilot benchmark**, not proof of broad superiority or production readiness.

Results appear in agent-harness-results (ignored by Git); inspect before publishing. The JSON contains per-attempt status, not raw model transcripts by default. Copy or summarize approved evidence into [the evidence ledger](agent-harness-evidence.md) only after independently confirming the numbers.

## Threat model and limitations

**Disposable Git worktrees are version-control isolation, not a hardened OS or container sandbox.** Codex requests workspace-write mode; the effective security still depends on your installed CLI, host, and configuration.

- Git, pytest, and Codex are launched as argument arrays without shell evaluation.
- Child environments do not inherit common API, AWS, or GitHub token variables. However, local files, credential stores, and tool integrations on the host may still be reachable.
- The harness rejects edits outside the allowed file and changes to the worktree's commit. This is an *after-the-fact* gate, not a firewall or an assurance that an agent cannot issue side effects during execution.
- Agent prompts prohibit pushes, deployments, or external communication. Enforcement of outbound access requires stronger isolation beyond this repository.
- Timeouts and bounded retries reduce runaway work. The synthetic CI job needs no credentials or model calls.
- Do not run hostile source code, untrusted plan data, or production secrets in this local harness without a genuinely isolated environment.
- No Terraform apply or deployment is part of these evaluations.

## Resume evidence threshold

A successful synthetic CI run proves harness plumbing and guardrail tests, **not that Codex can repair the product**. A real, repeatable run plus failures, metrics and commit-linked documentation supports **Agent Harness Engineering**. To strengthen an **advanced** claim, expand the task corpus, demonstrate measurable improvement over a controlled baseline, add hardened execution isolation and multi-agent review, and capture operational failures and fixes. See the evidence ledger for current status.
