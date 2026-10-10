# Security Model

## TL;DR

TerraGate treats Terraform plans and PR patches as sensitive artifacts, uses deterministic evidence before AI output, and requires versioned approval for GitHub comments. Checks update automatically. The public demo is intentionally guarded but not a hardened multi-tenant SaaS deployment. See the [workspace implementation](enterprise-workspace.md) and [verified deployment](deployment.md#verified-public-demo-release).

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

- Secret-like keys and Terraform sensitivity masks/outputs are redacted. Unknown or redacted policy inputs require verification instead of producing invented definite evidence.
- GitHub patch context is redacted before it is stored or shown.
- LLM reviewer nodes operate on reduced evidence summaries.
- Policy findings include evidence paths, rule IDs, confidence, and reviewer source.
- GitHub comments require approval of an exact review snapshot, including draft, findings, artifact hashes, policy inputs, and reviewed PR head. Live PR heads are checked again before posting. Check updates run automatically during review.
- Generated remediation snippets cannot be approved or committed; their export controls provide guidance for local adaptation. Complete source-verified diffs use context checks, Terraform syntax/format checks, and non-force branch updates in the adapter; automatic generation and full module validation are not implemented.
- Public demo mode mocks GitHub writes by default.
- Public demo mode disables sandbox Terraform execution by default.
- Private Cognito authentication validates issuer, signature, expiry and client, then requires active subject/org membership and its database role. JWT groups cannot grant permissions on their own.
- Redacted-plan reads are scoped to the run organization and check artifact root and SHA-256. Raw files are not exposed by a download route. New files/directories use 0600/0700 permissions; uploaded names cannot overwrite generated redacted artifacts.
- Exceptions bind one finding to one snapshot, require a different administrator and expiration, and persist attributed decisions without reducing raw risk or changing comment approval/GitHub checks.
- Webhooks fail closed without `GITHUB_WEBHOOK_SECRET` and compare HMAC signatures. Delivery replay protection and installation ownership are not implemented.
- The Terraform reference stack defines private, encrypted RDS accessible from Lambda's security group. The hosted demo instead uses Neon PostgreSQL with TLS and Lambda outside a VPC; it does not have that private-network boundary.

## Least-Privilege IAM Approach

The AWS public-demo Terraform reference uses narrow roles for the components it provisions; this is not an exact live inventory:

- CodeBuild can write logs and push/pull images in the TerraGate ECR repository.
- Lambda uses AWS-managed basic execution and VPC access policies for logs and VPC networking.
- RDS is not publicly accessible and is protected by security-group boundaries.

The hosted Lambda/database configuration differs from the reference. A production deployment should reconcile runtime IAM/network inventory, replace broad AWS-managed VPC permissions where practical, and move secrets out of Terraform state. TLS to Neon is not equivalent to private RDS security-group isolation.

## Auth And Authorization

- `AUTH_MODE=dev` is used for local/public demo flows and should not be treated as production auth.
- Cognito mode validates signed JWTs and active persisted membership. The browser prefers ID tokens containing the trusted organization attribute; the API validates their audience. Operator provisioning/revocation is documented in [private setup](enterprise-workspace.md#migration-and-private-auth-setup).
- Review, finding, plan, report, audit and exception access is scoped at the application level. PostgreSQL row-level security, first-class organization management, GitHub installation ownership, and organization-owned policies are not implemented.
- Cognito organization admins cannot edit shared policy files through the API; those files remain operator-managed until ownership is implemented. Local dev admin editing is retained, and public-demo policy edits remain disabled.
- Private production mode refuses dev-header authentication. Public-demo records remain shared and anonymous identities are not trustworthy customer identities.

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
5. Add approval/versioning and ownership for policy changes; evaluated snapshots and content hashes are already saved per run.
6. Add audit export and administrative access review.
