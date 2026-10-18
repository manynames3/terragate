# Four-minute TerraGate v2 interview demo

Use synthetic inputs and the existing local UI. Keep `STATE.md` visible. This script has an honest implementation-only version: there is currently no live model or held-out result to show. Never relabel controlled fixtures as actual GenAI outputs.

## 0:00–0:35 — The proposed change

Open `evaluations/dataset-v1/inputs/sg-ssh-risk.json` beside its safe neighbor. The changed resource permits TCP 22 from `0.0.0.0/0`; the safe neighbor restricts sources. Point out the before/after representation and that descriptions/tags are not trusted instructions. No Terraform is executed.

## 0:35–1:15 — The actual original reviewer

Open the saved **offline baseline** result for `iam-deny-safe` or `s3-acl-risk`. Explain that this is the frozen original graph with its model disabled, not a recorded model response. Show its actual rule output and provenance. Its live prompt/configuration is preserved in the archive. If a real live baseline artifact is later available, use that instead and show its mode, timestamp and source digest.

## 1:15–2:05 — Retrieval and candidate assessment

Show `AWS-VPC-SG` in `app/policies/evidence-v1.json` and the candidate input/validation code. In the UI, a controlled-provider test fixture can demonstrate the evidence tab: actual changed resource, scoped citation, model interpretation alongside deterministic origin, missing routes/ACLs/approved networks, and conditional mitigation. Label the fixture as **controlled provider QA**. Normal keyless reviews show `disabled` and retain rule findings; they do not pretend a model ran.

Discuss the RDS caveat: public addressing is not proof of connectivity. S3 default encryption also prevents the old absent-resource wording from implying unencrypted uploads. Show unknown values remaining `needs_context`.

## 2:05–2:45 — Evaluation and the held-out boundary

Run `python -m evaluations.cli validate`. Show 40 development and 20 held-out cases and separate label files. Open the saved development reports and count TP/TN/FP/FN, critical misses, invalid cases and model explanation coverage.

Say explicitly: “These are controlled/offline application results. Live baseline/candidate inference and the first held-out evaluation have not run, so I cannot claim improved GenAI accuracy.” Do not open held-out outputs for tuning. Once authorized live runs exist, replace this segment with their actual saved comparison and first held-out report, including any failures.

## 2:45–3:25 — A regression rejected by the CI gate

Run:

```bash
PYTHONPATH=apps/api:. python -m pytest -v evaluations/tests/test_evaluation.py -k 'constant_reviewers or stale_evidence or missing_failed'
python -m evaluations.cli gate --baseline evaluations/accepted/development-baseline.json --candidate evaluations/accepted/development-candidate.json --manual evaluations/accepted/development-manual.json
```

The first command demonstrates that an always-safe reviewer fails recall/critical requirements, an always-risky reviewer fails precision, and stale/partial artifacts fail. This is a **local reproduction of CI's gate tests**, not a claim that a remote GitHub check ran. The second command currently exits nonzero with `unevaluated` because live artifacts are missing. Show the matching job in `ci.yml`, with offline tests separated from quality evidence and no fork secrets.

## 3:25–4:00 — Cost, latency and an honest limitation

Show measured local graph/worker latency in the saved reports and `usage=null` where no provider returned telemetry. Offline tests made zero paid calls. Explain the published-rate upper estimate of $8.23 for one full 60-case baseline/candidate experiment, not observed billing or a project-wide cap.

Finish with a real remaining limitation: matching a citation ID cannot establish that it supports a recommendation. The gate requires four human explanation assessments including critical and unknown cases, and no such live semantic review has been completed. The separate Cloudflare frontend preview uses the existing demo API; demonstrate the grounded reviewer locally. No grounded-backend deployment, production-readiness or accuracy improvement is claimed.
