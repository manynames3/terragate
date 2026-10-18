# TerraGate v2 state

Local implementation and verification on **2026-10-16, America/New_York** (saved run timestamps use UTC). Started from a clean GitHub clone at `46988c330d2a18e6f68058db277665aae23e24d4`. On October 18, the owner authorized a `v2` branch push and a separate Cloudflare frontend release at `terragate2.pages.dev`. Deployment observations are recorded in the deployment guide. The shared AWS backend remains unchanged; the frontend explicitly labels this boundary. No Terraform apply or paid model evaluation is authorized by that release.

## Implemented

- The production FastAPI/LangGraph path now has one bounded evidence-grounded model stage, strict resource/attribute/citation checks, explicit uncertainty/fallback status and preserved deterministic provenance.
- Eleven curated evidence entries: nine official AWS summaries and two authored project policies. Local scoped retrieval, expiry/conflict/instruction-like quarantine and context limits; no runtime browsing, vector service or embeddings.
- Grounding persists through Alembic `0010` and appears in the existing finding inspector/report. Approval snapshots include it. Probability-style confidence labels were removed.
- Existing rules/templates were corrected for Deny wildcards, required unscoped read actions, trust/S3 exposure, no-op recovery checks, ambiguous policies, RDS/S3 caveats, service ports and unverified resource examples. Raw graph trace export is disabled because state contains original plan data.
- Versioned 60-case synthetic dataset, separate labels, immutable original source baseline, real-graph runner, offline/live/replay separation, deterministic scoring, explicit promotion, manual semantic rubric and current-source CI gate.
- PR offline checks retained/extended; opt-in owner-reviewed live workflow added. Missing live artifacts deliberately fail the quality job as unevaluated. No branch-protection setting was changed.
- [Architecture/operation](docs/terragate-v2.md), [evaluation commands/methodology](docs/evaluations.md), [policy](docs/v2-policy.md), [ADR](docs/adrs/0009-grounded-review-and-regression-evidence.md) and [four-minute demo](docs/demo-v2.md).

No new production dependency or always-on infrastructure was introduced. Ruff/Checkov are development tools. The October 18 frontend release uses a separate Pages proxy and OpenNext Worker; existing documentation distinguishes the hosted Neon database from the Terraform RDS reference deployment.

## Verification actually performed

| Check | Observed result |
| --- | --- |
| Full backend suite (`make test`, backend part) | **123 passed**; three upstream deprecation/serializer warnings |
| Evaluation mechanics suite | **15 passed** |
| PostgreSQL 17.10 isolated migration preservation | **2 passed**, including SQLite/PostgreSQL preservation; temporary local server stopped and removed |
| Structured-provider adapter | Controlled HTTP round trip through the real LangChain/OpenAI adapter; schema, limits, returned usage and one-attempt timeout checked |
| Application adapter | Controlled provider through the actual graph and FastAPI persistence/retrieval path passed |
| Failure coverage | Invented resources/evidence/prose references, irrelevant/missing/stale/conflicting/instruction-like evidence, malformed output/policy/masks, hidden/unknown values, limits, timeout/concurrency, partial/duplicate/stale runs, incompatible model/provider/baseline, promotion tampering, critical misses, false positives and report escaping |
| Frontend | 5 tests; typecheck, ESLint, production build passed |
| Cloudflare local runtime | OpenNext build plus four route shells and Stratum asset passed in `workerd`; no deployment |
| Running UI | Controlled-provider fixture inspected at desktop and 390px mobile; documentation/missing-context views present, no probability label, measured document width equals viewport width |
| Checkov 3.3.29 | Selected supported HCL controls: **4 passed, 0 failed, 0 skipped**; not reviewer evaluation or a full audit |
| Terraform | Formatting check passed; no infrastructure edits/apply. `terraform validate` was not rerun for this change |
| Workflow syntax | Actionlint 1.7.12 passed both workflows; shellcheck integration was unavailable/disabled |
| Python/diff | Focused Ruff checks and `git diff --check` passed |
| Repowise | Status/context/update attempted; fresh clone has no index or prior sync, and MCP tools were unavailable. No indexed risk analysis was claimed |

The UI images at `/tmp/terragate-v2-controlled-desktop.png`, `/tmp/terragate-v2-controlled-mobile.png` and `/tmp/terragate-v2-controlled-mobile-evidence.png` are actual local captures of a **controlled provider test fixture**, not model-quality or production evidence. Existing npm tooling audit findings (14: 13 high, 1 low reported by `npm ci`) were not repaired or reassessed as part of this feature; application dependencies were not changed.

## Actual offline comparison

Dataset checksum: `775ad6d41660317f08ddccc50f9f71f25274a8e57849b31d50bf3ea686b9620c`.

Both runs cover all **40 development cases**. Baseline uses its original graph with model access disabled. Candidate uses the revised production graph with a controlled empty model response. **These numbers measure rule/mechanics behavior, not GenAI quality.**

| Measure | Frozen baseline | Candidate |
| --- | --- | --- |
| TP / TN / FP / FN | 16 / 16 / 3 / 3 | 19 / 19 / 0 / 0 |
| Precision / recall / F1 | .842 / .842 / .842 | 1.000 / 1.000 / 1.000 |
| Exact classification | 33/40 | 40/40 |
| Expected findings matched | 16/19 | 19/19 |
| Malformed inputs rejected | 2/2 | 2/2 |
| Critical misses / execution errors | 0 / 0 | 0 / 0 |
| Model-grounded expected explanations | 0/19 | 0/19 |
| Local graph/worker mean latency | 204.96 ms | 161.94 ms |
| Local graph/worker maximum latency | 315.15 ms | 267.23 ms |
| Paid provider calls / returned provider usage | 0 / unavailable | 0 / unavailable |

These are single local runs, with concurrent local tooling and process-import effects, not a performance benchmark or statistically established improvement. Rules, prompt, retrieval and validation changed together. No improvement is attributed to GenAI or retrieval from these results.

Saved private artifacts (ignored by Git):

- [Baseline JSON](evaluations/results/evidence-development-baseline-offline.json), [candidate JSON](evaluations/results/evidence-development-candidate-offline.json)
- [Comparison JSON](evaluations/results/evidence-development-comparison.json)
- [Baseline report](evaluations/results/evidence-development-baseline.md), [candidate report](evaluations/results/evidence-development-candidate.md)
- [Expected failing offline verdict](evaluations/results/evidence-development-gate.json)
- [Missing-live verdict](evaluations/results/missing-live-gate.json)

Candidate source and evaluator digests were checked against the current files. The gate rejects these artifacts because live evidence, sufficient model explanations and human semantic assessments are missing. Constant-reviewer tests independently demonstrate recall/critical failures for always-safe and precision/false-positive failures for always-risky. No baseline was promoted.

## Remaining validation and limits

**Live GenAI quality is UNEVALUATED.** No provider API key was present. Live baseline/candidate inference, actual provider latency/usage/billing, the first held-out inference and human semantic assessments were not performed. All 20 held-out cases remain uninferred; development tuning did not use held-out results. No remote GitHub Actions run or branch protection was verified.

The concrete live commands are in `docs/evaluations.md`. At the documented GPT-5.4 mini rates and configured token caps, one complete 60-case baseline/candidate experiment is estimated at at most **$8.23** (300 maximum requests). That is a published-rate estimate, not observed billing or an account-wide spend cap. **Zero paid model calls** were made during implementation.

The corpus and labels are authored, narrow and not independent certification. Reference validity/resource relevance cannot prove semantic support. Unknown account controls, runtime connectivity, backup restore readiness, unmarked secrets and larger/unsupported plans require human verification. Timeouts/concurrency are bounded as documented; production-scale tenant isolation, global budget enforcement and worker recovery are not established.

MCP was excluded without a concrete client workflow or approved additional server dependency. AgentCore Evaluations was excluded before adding AWS instrumentation/IAM/region/spend complexity; its current integration requirements were not validated. There are no unconnected stubs or claimed client round trips.
