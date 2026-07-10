# Security Model

## TL;DR

TerraGate treats Terraform plans and PR patches as sensitive artifacts, uses deterministic evidence before AI output, and blocks external GitHub writes until approval. The current public demo is intentionally guarded but not a hardened multi-tenant SaaS deployment.

## Data Classification

| Data | Sensitivity | Handling |
| --- | --- | --- |
| Terraform plan JSON | High | Stored as an artifact; redacted before reviewer enrichment; never sent raw to optional LLM calls. |
| Redacted plan/evidence | Medium | Used by deterministic checks, reviewer nodes, reports, and UI. |
| GitHub PR metadata and patches | Medium to high | Patch snippets are redacted and truncated before storage/use. |
| Findings/evidence/remediation | Medium | Persisted for review history and auditability. |
| Approval decisions | Medium | Persisted with notes and timestamps. |
| GitHub/App tokens | High | Supplied by environment variables; not required for public demo. |

## Controls Implemented

- Secret-like keys are redacted in Terraform plan values.
- GitHub patch context is redacted before it is stored or shown.
- LLM reviewer nodes operate on reduced evidence summaries.
- Policy findings include evidence paths, rule IDs, confidence, and reviewer source.
- GitHub comments, check updates, and patch commits require approval.
- Public demo mode mocks GitHub writes by default.
- Public demo mode disables sandbox Terraform execution by default.
- Cognito JWT validation and group-to-role mapping are available for private deployments.
- AWS demo RDS is private, encrypted, and only allows PostgreSQL from Lambda's security group.

## Least-Privilege IAM Approach

The AWS public-demo Terraform uses narrow roles for the components it provisions:

- CodeBuild can write logs and push/pull images in the TerraGate ECR repository.
- Lambda uses AWS-managed basic execution and VPC access policies for logs and VPC networking.
- RDS is not publicly accessible and is protected by security-group boundaries.

This is acceptable for a small demo stack. A production deployment should replace broad AWS-managed Lambda VPC permissions with a more constrained custom policy where practical and should move secrets out of Terraform state.

## Auth And Authorization

- `AUTH_MODE=dev` is used for local/public demo flows and should not be treated as production auth.
- Cognito mode validates JWKS-signed JWTs and maps Cognito groups to roles.
- Current org scoping exists at the application level, but full production tenant isolation would need first-class organizations, GitHub installation-to-org mapping, and policy ownership.

## Secret Management

- `.env`, `.env.*`, Terraform state, and tfvars files are ignored.
- `.env.example` documents expected configuration without secrets.
- The public-demo Terraform currently places the generated database URL in Lambda environment variables and Terraform state. That is acceptable for disposable demo infrastructure but not ideal for production.
- Production direction: SSM/Secrets Manager or an equivalent secret store, with rotation and no secrets in Terraform outputs.

## Known Security Gaps

- Lambda `/tmp` artifact storage is ephemeral and not customer-retention aware.
- Public-demo auth is dev mode.
- Terraform sandboxing is not hardened for multi-tenant untrusted code execution.
- Policy-pack edits do not yet have approval/versioning.
- No customer-facing artifact deletion workflow exists yet.

## Production Hardening Path

1. Require Cognito or another real IdP outside local development.
2. Add organization/repository registration and GitHub App installation ownership.
3. Store artifacts in S3 with SSE-KMS, retention policies, and explicit delete controls.
4. Use a durable queue and isolated worker runtime for untrusted Terraform execution.
5. Snapshot policy versions per run.
6. Add audit export and administrative access review.
