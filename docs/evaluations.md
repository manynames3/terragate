# Reviewer evaluation

The reviewer under test is the actual application graph. `evaluations/worker.py` invokes `run_terraform_review`; it does not implement another risk engine. Candidate adapter tests also exercise the HTTP/structured-output boundary and the real FastAPI persistence path with controlled provider responses.

## Frozen dataset and baseline

`evaluations/dataset-v1` contains 60 distinct synthetic requests and separately stored authored labels. Version 1.0.0 has 40 development and 20 held-out cases. Related safe/risky variants share a split; equivalent root/module IAM and trust-principal representations are grouped. Inputs are deduplicated, paths constrained and references validated. Coverage includes IAM, trust, IPv4/IPv6 ingress, RDS public/encryption/recovery settings, S3 ACL/policy/protection, stateful deletion/replacement, mixed/nested plans, unknown/sensitive values, malformed inputs and instruction-like contents. Retrieval-injection and missing/conflicting/irrelevant evidence also have dedicated application tests.

These are project-authored benchmark labels, not independently certified ground truth or a representative sample of every Terraform/AWS configuration. The same author implemented the reviewer and benchmark. Safe cases permit unrelated low-priority tagging advice. Material risks are medium-or-higher; `needs_context` is a distinct exact class and a positive review-required result in binary detection scoring.

Tune only with development cases. Held-out inference requires `--allow-held-out`. Freeze reviewer behavior before its first live run; preserve that result, report failures, and use a new held-out dataset version after further tuning. An opt-in flag discourages accidental access; it is not an access-control boundary against the author reading the files.

`evaluations/baseline/source.tar.gz` is an unmodified `git archive` of the original app and requirements at `46988c3` (full SHA and archive checksum in its manifest). Inspect with `tar -tzf` or extract into a temporary directory. The baseline graph, rules, prompt, existing resource truncation and silent fallback behavior are preserved. The evaluation wrapper adds at most four model requests, no SDK retries, 30-second request timeout, 4,096 completion-token cap, conservative 12,000-token input bound and usage collection. A swallowed baseline provider failure is reported as an evaluation error rather than hidden behind its fallback text.

The candidate changes rules, model inputs, one-call prompt, local retrieval and output validation together. The baseline uses its original temperature 0; candidate pins low reasoning and omits unsupported temperature assumptions. Both use the documented snapshot `gpt-5.4-mini-2026-03-17`. Snapshot/settings reduce variation, not eliminate it. A provider incompatibility in the legacy configuration is an observed baseline error, not permission to fabricate a result or silently rewrite its prompt.

## Commands

Activate the root `.venv`. All files below use fresh names because saved runs and promotions cannot be overwritten.

```bash
python -m evaluations.cli validate
PYTHONPATH=apps/api:. python -m pytest -q evaluations/tests
make test

# Actual graph, controlled empty model output / original deterministic path; no API calls.
python -m evaluations.cli run --reviewer baseline --out evaluations/results/dev-base-offline.json
python -m evaluations.cli run --reviewer candidate --out evaluations/results/dev-candidate-offline.json
python -m evaluations.cli score evaluations/results/dev-candidate-offline.json
python -m evaluations.cli compare evaluations/results/dev-base-offline.json evaluations/results/dev-candidate-offline.json
python -m evaluations.cli report evaluations/results/dev-candidate-offline.json --out evaluations/results/dev-candidate.md

# Replay preserves original source/config digests and records its origin; it is not a new live run.
python -m evaluations.cli replay evaluations/results/dev-candidate-offline.json --out evaluations/results/replay.json

# Only after configuring OPENAI_API_KEY and explicitly authorizing the bounded spend:
python -m evaluations.cli run --reviewer baseline --mode live --allow-live --budget-usd 4.40 --out evaluations/results/dev-base-live.json
python -m evaluations.cli run --reviewer candidate --mode live --allow-live --budget-usd 1.10 --out evaluations/results/dev-candidate-live.json
python -m evaluations.cli compare evaluations/results/dev-base-live.json evaluations/results/dev-candidate-live.json
python -m evaluations.cli manual-template evaluations/results/dev-candidate-live.json --out evaluations/results/dev-manual.json
```

After development is frozen, repeat the two live run commands with `--split held_out --allow-held-out` and distinct output names. Conservative split budgets are $2.20 baseline and $0.55 candidate. `--limit` can prepare a pilot, but partial runs fail coverage and cannot be promoted. `Ctrl-C` records completed cases and a cancellation reason. The subprocess deadline kills a stuck worker. Disabling live mode needs no credential changes: omit the live flags. Cancel the Actions run to stop an ongoing workflow; no schedules run later.

Explicit promotion and gate:

```bash
python -m evaluations.cli promote evaluations/results/dev-base-live.json --out evaluations/accepted/development-baseline.json --reason "Original reviewer comparison baseline"
# Deliberately copy the inspected current live candidate and completed human rubric to:
# evaluations/accepted/development-candidate.json and development-manual.json
python -m evaluations.cli gate --baseline evaluations/accepted/development-baseline.json --candidate evaluations/accepted/development-candidate.json --manual evaluations/accepted/development-manual.json --out evaluations/results/development-gate.json
```

Use equivalent `held_out-*` accepted filenames for the second split. Promotion is explicit, requires a complete error-free live run, records the reason and content digest, and refuses an existing destination. Promoting a baseline need not satisfy candidate quality floors: preserving a weak baseline is necessary for an honest comparison. No threshold or baseline is automatically replaced. Later accepted candidate versions can be deliberately promoted as the comparison baseline.

## Scoring and gate

Every expected case remains in the denominator. Missing/failed positives become FN; missing/failed safe cases become FP, rather than successful TN. Malformed input cases are separately counted as correct/incorrect rejections. Duplicate/extra results, incompatible checksums, invalid resource/citation references and unsupported outputs fail validation. Report completed/total, errors, invalid outputs, exact classes, TP/TN/FP/FN, precision/recall/F1, critical misses and per-family counts. All zero-denominator ratios equal zero. Critical detection requires a critical finding on the expected resource, not just a generic risky class.

Finding matching checks address, observed attribute path/facts and minimum severity. Evidence IDs and resource scope are checked separately. Model grounding coverage requires an explanation with an acceptable scoped evidence ID. These are structural proxies, not semantic proof that a recommendation follows from a document.

Current candidate gates require:

- 100% case coverage, no execution/invalid-output errors, and all malformed examples rejected.
- Zero critical misses.
- Precision ≥ .85, recall ≥ .90, F1 ≥ .87, exact class accuracy ≥ .85, expected-finding recall ≥ .80, model-grounded finding coverage ≥ .60.
- No additional FP/FN and no lost TP/TN relative to a compatible baseline; counts accompany ratios.
- A current candidate application-source, prompt, corpus, inference-configuration and evaluator digest. Dataset/split, model/settings, evaluator and recorded dependency versions must agree between runs. Artifacts do not depend on their own commit hash.
- At least four inspectable human explanation assessments, including a critical case and a `needs_context` case, bound to exact per-case result digests. Offline and replay artifacts cannot produce a live quality pass.

The human rubric has four separate yes/no questions: does the explanation match an actual plan change; is its cited evidence relevant; does the evidence support the recommendation; does it acknowledge important missing context? Record the reviewer and substantive notes, including unsupported conclusions. A schema-valid reference alone cannot answer the last three questions. There is no LLM judge presented as ground truth. Unit tests show that always-safe fails recall/critical requirements and always-risky fails precision/false-positive requirements.

These fixed floors are authored acceptance criteria, not statistically established significance thresholds. A single changed case moves small-sample percentages noticeably. Report counts and preserve unfavorable results. Changing the benchmark/scorer requires compatible new evidence; do not relabel or loosen floors to pass.

## Traceability, telemetry and cost

Saved runs include dataset/split checksum, source/prompt/corpus/configuration-related digests, pinned provider/model/settings, mode, UTC timestamp, installed relevant package versions, per-case output/error, graph/worker latency, returned token usage and costs where derivable. Process startup is additionally included in total run elapsed time. Failed requests without returned usage retain unknown cost. An invalid parsed response still retains usage if the provider returned it.

Published standard GPT-5.4 mini rates checked on 2026-10-16 are [$0.75/M input and $4.50/M output](https://developers.openai.com/api/docs/models/gpt-5.4-mini). Estimates ignore cache discounts and are not observed billing. At 12,000 input / 4,096 completion tokens, the estimate is $0.027432/request. Across 60 cases, at most 240 baseline plus 60 candidate requests gives $8.2296. Budget checks assume those rates and no SDK retry; they are not an account-wide billing cap. No provider calls or charges were incurred by the offline/controlled checks performed for this implementation.

Runs are private files by default and ignored by Git. Treat real-plan findings and identifiers as sensitive before deliberate sharing. Accepted evidence is a human-reviewed repository artifact, not cryptographically attested proof of provider execution; its digests detect mismatches/staleness, not dishonest artifact authorship.

## CI

Every PR retains backend/migrations, frontend test/type/lint/build/Cloudflare-runtime and Terraform checks, and adds dataset/evaluator tests and focused v2 lint. No existing Checkov job was present. The new Checkov scan targets supported Terraform HCL and explicitly selects RDS encryption, RDS public-access and SSH ingress controls; it is not a full infrastructure security audit and is never counted as reviewer accuracy.

The separate `reviewer-quality` job always evaluates both accepted splits. Missing, stale, incompatible or offline-only evidence fails explicitly as unevaluated. The initial change therefore does **not** come with a green model-quality verdict. Branch protection has not been configured.

`live-evaluation.yml` is workflow-dispatch only, from main, by the repository owner, with an explicit reviewed-source/spend checkbox and a 40-character SHA that must be an internal branch tip. PR/fork events never receive provider secrets. Review the candidate code, dependencies, dataset and workflow before dispatch; internal code is not inherently trusted. The workflow uses only the provider secret, read-only repository permissions, sequential bounded inference and seven-day artifacts. It does not automatically promote or announce quality success. No OIDC role or hosting resource is needed for the existing OpenAI provider.

## Current validation status

See [STATE.md](../STATE.md) and the generated local reports under `evaluations/results`. No API credential was available during implementation. Offline graph runs and controlled HTTP/API tests validate mechanics and rule behavior only. Live baseline/candidate inference, first held-out inference and inspectable human semantic assessments remain unperformed. Do not present the offline F1 as GenAI accuracy or claim improvement from retrieval without those results.
