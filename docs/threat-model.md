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

## Future Hardening

- Encrypt artifact storage.
- Add object storage retention and access policies.
- Add user-scoped authorization.
- Add audit logging for approval and posting actions.
- Add policy exception workflow.
- Run OPA/Rego policies in addition to Python checks.
