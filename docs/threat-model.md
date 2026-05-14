# Threat Model

## Sensitive Terraform Data Risk

Terraform plan JSON can contain passwords, generated secrets, provider tokens, connection strings, and sensitive outputs. It can also expose internal architecture.

Mitigations:

- Raw plans are stored as artifacts and treated as sensitive.
- Redaction runs before AI review.
- Keys matching password, secret, token, API key, access key, private key, credential, auth, or cert are replaced with `[REDACTED]`.
- LLM calls receive only reduced evidence summaries, never the full raw plan.
- UI warns users before upload.

## LLM Hallucination Risk

An LLM-only reviewer could invent resources, misread Terraform actions, or recommend unsafe remediations.

Mitigations:

- Deterministic checks generate findings first.
- Reviewer nodes are constrained to explain and prioritize existing deterministic evidence.
- Findings require evidence, confidence, source, reviewer node, and human-review flag.
- Low confidence can require human review.
- App works without an LLM.

## GitHub Posting Risk

An AI-generated comment is externally visible and could include sensitive details or incorrect instructions.

Mitigations:

- GitHub posting is blocked unless the run is approved.
- Approvals and rejections are persisted.
- Missing credentials or metadata return a mock response.
- The comment uses redacted evidence and concise remediation snippets.
- GitHub check runs are created from summarized status and do not include raw plan artifacts.

## GitHub PR Context Risk

Changed file patches can contain sensitive code, secrets, internal paths, and operational details.

Mitigations:

- PR context is stored as a separate artifact so retention and access controls can be tightened independently.
- File patches are redacted for sensitive assignments and truncated before persistence.
- PR context is used as review metadata and displayed to the operator; Terraform findings still come from parsed plan JSON and deterministic policy checks.
- Missing credentials return a dev placeholder rather than encouraging users to paste tokens into the UI.

## Secret Leakage Risk

Secrets can leak through raw plan uploads, logs, database rows, traces, or PR comments.

Mitigations:

- Raw artifacts stay in local artifact storage for dev.
- Redacted artifacts are used by review nodes.
- Evidence for secret findings stores `[REDACTED]`.
- LangSmith tracing is opt-in through environment variables.
- PR comments are generated from structured findings, not raw plan JSON.

## Sandbox Terraform Execution Risk

Running Terraform against arbitrary code can execute provider/plugin behavior, download binaries, or expose local credentials.

Mitigations:

- Sandbox execution is disabled by default.
- The runner only accepts working directories under `TERRAFORM_SANDBOX_ROOT`.
- Source code is copied to a temporary isolated directory before execution.
- `.git`, `.terraform`, and local state files are ignored during copy.
- The runner uses `terraform init -backend=false` and `terraform plan -refresh=false`.
- Environment variables are scrubbed to a small allowlist plus `TF_*` automation variables.
- Backend config is opt-in; when enabled, only configured key names are stored in metadata.
- Docker execution is available through `TERRAFORM_SANDBOX_DRIVER=docker`, using a mounted copy of the workspace and the configured network policy.
- Webhook-triggered reviews require a preconfigured sandbox working directory instead of arbitrary paths from GitHub payloads.

## Cost Estimation Risk

Cost estimates can be wrong or incomplete when pricing data is stale or resource attributes are unknown.

Mitigations:

- Infracost CLI is used when installed and configured.
- The fallback estimator labels itself as heuristic and includes per-resource confidence.
- Policy packs set explicit monthly delta thresholds and over-threshold estimates require human review.

## Suggested Patch Risk

Generated remediation patches can be incomplete or unsafe if applied blindly.

Mitigations:

- Patches are stored as drafts and require separate approval.
- Patch commits are a separate approval-gated action and only target same-repository PR branches.
- Fork PRs return a mock response instead of writing to an untrusted branch.
- Diffs include finding/resource context and should be reviewed by an operator.

## Authorization Risk

Approval, policy, and patch actions need stronger authorization than demo upload flows.

Mitigations:

- Local development uses explicit `X-CloudOps-User-*` and `X-CloudOps-Role` headers only when `AUTH_MODE=dev`.
- Production-style deployments can set `AUTH_MODE=cognito` to require signed Cognito bearer tokens on API routes.
- Cognito tokens are validated against issuer/JWKS, optional app client id, expiration, and token use.
- Cognito groups and `custom:role` claims map to `platform-admin`, `reviewer`, and `viewer`.
- Sensitive actions are role-gated in one FastAPI dependency boundary.
- Audit events include actor identity where available.

## Webhook Abuse Risk

GitHub webhooks can be spoofed or replayed if accepted without verification.

Mitigations:

- `GITHUB_WEBHOOK_SECRET` enables `X-Hub-Signature-256` verification.
- Unsupported events/actions are accepted as no-ops and do not start work.
- The webhook route only uses configured sandbox paths; it does not trust repo paths from the payload.

## Future Hardening

- Encrypt artifact storage.
- Add object storage retention and access policies.
- Add persisted org membership, resource-level authorization, and policy-pack approval workflows.
- Move audit logging to immutable retention.
- Add policy exception workflow.
- Run OPA/Rego policies in addition to Python checks.
