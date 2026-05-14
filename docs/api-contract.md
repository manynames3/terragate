# API Contract

Base URL: `http://localhost:8000`

Auth:

- `AUTH_MODE=dev`: optional local headers are accepted for demos.
- `AUTH_MODE=cognito`: every API route except `POST /api/v1/github/webhook` requires `Authorization: Bearer <Cognito access token or ID token>`.

Dev auth headers:

- `X-TerraGate-User-Email`: optional actor email.
- `X-TerraGate-User-Name`: optional actor display name.
- `X-TerraGate-Role`: optional role. Defaults to `platform-admin`; use `reviewer` for approval flows and `viewer` to verify restricted actions.
- Legacy `X-CloudOps-*` headers are still accepted for older local scripts.

Cognito role mapping:

- `terragate-admins` -> `platform-admin`
- `terragate-reviewers` -> `reviewer`
- `terragate-viewers` -> `viewer`
- `custom:role` can override when set to `platform-admin`, `reviewer`, or `viewer`.

## GET /api/v1/auth/me

Returns the current authenticated actor:

```json
{
  "id": "user-123",
  "email": "reviewer@example.com",
  "name": "Review Lead",
  "role": "reviewer",
  "org_id": "acme",
  "groups": ["terragate-reviewers"],
  "auth_provider": "cognito"
}
```

## POST /api/v1/terraform-reviews

Multipart form upload. Requires `reviewer` or `platform-admin`.

Fields:

- `file`: Terraform plan JSON. Required for `execution_mode=uploaded_plan`.
- `environment`: `dev`, `staging`, or `prod`.
- `cloud_provider`: `aws`, `azure`, `gcp`, or `unknown`.
- `repo_owner`: optional.
- `repo_name`: optional.
- `pull_number`: optional.
- `policy_profile`: `default`, `restricted`, or another named profile.
- `execution_mode`: `uploaded_plan` or `sandbox_plan`.
- `terraform_working_dir`: relative path under `TERRAFORM_SANDBOX_ROOT` when `execution_mode=sandbox_plan`.
- `terraform_workspace`: optional Terraform workspace for sandbox execution.
- `terraform_env_vars_json`: optional JSON object of scoped `TF_*`, `AWS_*`, `ARM_*`, `AZURE_*`, `GOOGLE_*`, or `CLOUDSDK_*` env vars.
- `terraform_backend_enabled`: optional boolean.
- `terraform_backend_config_json`: optional JSON object used as `-backend-config` values when backend is enabled.
- `terraform_var_file`: optional var file path under the Terraform working directory.

Response:

```json
{
  "run_id": "run_xxx",
  "status": "queued"
}
```

## POST /api/v1/terraform-reviews/json

JSON upload path for browser-hosted/public-demo deployments where API Gateway/Lambda multipart handling is less predictable. Requires `reviewer` or `platform-admin`. The web UI reads the selected plan file client-side and sends the same file contents through this endpoint.

Request:

```json
{
  "file_name": "tfplan.json",
  "plan_json_text": "{\"format_version\":\"1.2\",\"resource_changes\":[]}",
  "environment": "prod",
  "cloud_provider": "aws",
  "policy_profile": "default",
  "repo_owner": "example",
  "repo_name": "infra",
  "pull_number": 42
}
```

Response:

```json
{
  "run_id": "run_xxx",
  "status": "queued"
}
```

## GET /api/v1/demo/sample-plans

Returns bundled sample plans that can be launched without uploading a file. This endpoint is intended for public demo mode.

## POST /api/v1/demo/terraform-reviews

Starts a review from a bundled sample Terraform plan. This exercises the same parser, redaction, policy, LangGraph, persistence, findings, report, and approval flow as uploaded plans. The endpoint is open when `PUBLIC_DEMO_MODE=true` or when running with local dev auth.

Request:

```json
{
  "sample": "risky-security"
}
```

Supported samples:

- `safe`
- `risky-security`
- `risky-cost`
- `destructive-prod`

Response:

```json
{
  "run_id": "run_xxx",
  "status": "queued"
}
```

## GET /api/v1/runs

Returns recent runs with risk and severity counts.

## GET /api/v1/runs/{run_id}

Returns run status, risk score, summary, graph progress, plan summary, cost estimate, blast radius, Terraform execution metadata, repo context, stored GitHub PR context, latest background job, latest GitHub check, suggested patch count, audit count, and timestamps.

## GET /api/v1/policy-packs

Returns configured policy packs loaded from `apps/api/app/policies/policy_packs`.

Policy pack fields include required tags, allowed regions, allowed instance families, max monthly cost delta, public ingress policy, production stateful deletion rules, and minimum production backup retention.

## GET /api/v1/policy-packs/{name}

Returns one policy pack with the same editable fields.

## PUT /api/v1/policy-packs/{name}

Updates an editable policy pack and records an audit event. Requires `platform-admin`.
When `PUBLIC_DEMO_MODE=true`, policy packs are read-only and this endpoint returns HTTP 403.

Editable fields:

- `description`
- `required_tags`
- `allowed_regions`
- `restricted_allowlist`
- `allowed_instance_families`
- `max_monthly_delta`
- `block_public_admin_ingress`
- `require_cost_center`
- `block_production_stateful_deletes`
- `require_deletion_protection_in_prod`
- `min_prod_backup_retention_days`

## POST /api/v1/github/webhook

Accepts GitHub App/webhook events.

Required headers:

- `X-GitHub-Event`
- `X-Hub-Signature-256` when `GITHUB_WEBHOOK_SECRET` is configured.

Supported trigger:

- `pull_request` actions: `opened`, `synchronize`, `reopened`, `ready_for_review`.

The webhook path generates a Terraform plan through the sandbox runner using `GITHUB_WEBHOOK_TERRAFORM_WORKING_DIR`. If that path is not configured, it returns HTTP 202 with `accepted: false` and a clear reason instead of pretending a review ran.

## GET /api/v1/github/pr-context

Query params:

- `repo_owner`
- `repo_name`
- `pull_number`

Fetches live GitHub PR context with `GITHUB_TOKEN` when configured. If the token is missing, returns a structured dev placeholder.

Response:

```json
{
  "available": true,
  "mock": false,
  "message": "Fetched live GitHub PR metadata and changed-file context.",
  "repo_full_name": "example/infra",
  "pull_number": 42,
  "title": "Harden production database",
  "state": "open",
  "author": "octocat",
  "base_ref": "main",
  "head_ref": "feature/rds-hardening",
  "changed_files_count": 3,
  "additions": 120,
  "deletions": 18,
  "terraform_files": [
    {
      "filename": "infra/rds.tf",
      "status": "modified",
      "additions": 40,
      "deletions": 4,
      "changes": 44
    }
  ]
}
```

## GET /api/v1/runs/{run_id}/findings

Returns structured findings:

```json
{
  "id": "fnd_xxx",
  "title": "Public ingress exposes sensitive service",
  "severity": "high",
  "category": "security",
  "resource_address": "aws_security_group.web",
  "change_actions": ["create"],
  "pr_file_path": "infra/security-groups.tf",
  "pr_file_url": "https://github.com/example/infra/blob/abc123/infra/security-groups.tf",
  "pr_patch": "@@ -1,3 +1,12 @@\n+resource \"aws_security_group\" \"web\" { ... }",
  "evidence": [
    {
      "json_path": "$.resource_changes[0].change.after.ingress[0]",
      "observed_value": "...",
      "expected_value": "Restricted CIDR ranges or private access",
      "rule_id": "SEC-SG-001",
      "explanation": "Ingress from 0.0.0.0/0 or ::/0 should not expose administrative or data ports."
    }
  ],
  "recommendation": "Restrict ingress to approved CIDR ranges, a VPN, or SSM Session Manager.",
  "runbook_checklist": [
    "Confirm approved source CIDR or private access path.",
    "Validate emergency access path such as SSM or VPN.",
    "Schedule post-change external exposure scan."
  ]
}
```

## GET /api/v1/runs/{run_id}/report

Returns report markdown, PR comment draft, remediation summary, and transparent risk score object.

## GET /api/v1/runs/{run_id}/fix-patches

Returns suggested remediation patch drafts:

```json
{
  "id": "fix_xxx",
  "run_id": "run_xxx",
  "finding_id": "fnd_xxx",
  "status": "draft",
  "pr_file_path": "infra/security-groups.tf",
  "summary": "Public SSH ingress: Restrict SSH to approved CIDRs.",
  "diff": "diff --git a/infra/security-groups.tf b/infra/security-groups.tf\n...",
  "created_at": "2026-05-14T18:00:00Z",
  "approved_at": null,
  "commit_url": null,
  "committed_at": null
}
```

## POST /api/v1/runs/{run_id}/fix-patches/{patch_id}/approve

Marks a suggested patch approved and records an audit event. Requires a reviewer or platform-admin role.

## POST /api/v1/runs/{run_id}/fix-patches/{patch_id}/github-commit

Commits an approved suggested patch to the PR branch when GitHub credentials and same-repository PR metadata are available. Requires `platform-admin`. If credentials are missing or the PR comes from a fork, returns a mock response and does not mutate GitHub.

If patch approval is missing, returns HTTP 409.

Response:

```json
{
  "run_id": "run_xxx",
  "patch_id": "fix_xxx",
  "committed": false,
  "mock": true,
  "message": "GITHUB_TOKEN or GitHub App credentials are not configured. Would commit approved patch to example/infra PR #42.",
  "commit_url": null
}
```

## GET /api/v1/runs/{run_id}/audit-log

Returns recent run audit events for queue/start/complete, approval decisions, GitHub check/comment actions, and patch approvals.

## POST /api/v1/runs/{run_id}/approve

Request:

```json
{
  "notes": "Approved after validating findings."
}
```

Marks the PR comment draft approved.

## POST /api/v1/runs/{run_id}/reject

Request:

```json
{
  "notes": "Needs updates before posting."
}
```

Marks the draft rejected.

## POST /api/v1/runs/{run_id}/github-comment

Posts the approved PR comment to GitHub. If approval is missing, returns HTTP 409. If credentials or repo metadata are missing, returns a mock/dev response.

Response:

```json
{
  "run_id": "run_xxx",
  "posted": false,
  "mock": true,
  "message": "GITHUB_TOKEN or GitHub App credentials are not configured. Would post to example/infra PR #42.",
  "comment_url": null
}
```
