# API Contract

Base URL: `http://localhost:8000`

## POST /api/v1/terraform-reviews

Multipart form upload.

Fields:

- `file`: Terraform plan JSON.
- `environment`: `dev`, `staging`, or `prod`.
- `cloud_provider`: `aws`, `azure`, `gcp`, or `unknown`.
- `repo_owner`: optional.
- `repo_name`: optional.
- `pull_number`: optional.
- `policy_profile`: `default`, `restricted`, or another named profile.

Response:

```json
{
  "run_id": "run_xxx",
  "status": "approval_pending"
}
```

## GET /api/v1/runs

Returns recent runs with risk and severity counts.

## GET /api/v1/runs/{run_id}

Returns run status, risk score, summary, graph progress, plan summary, repo context, and timestamps.

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
  "evidence": [
    {
      "json_path": "$.resource_changes[0].change.after.ingress[0]",
      "observed_value": "...",
      "expected_value": "Restricted CIDR ranges or private access",
      "rule_id": "SEC-SG-001",
      "explanation": "Ingress from 0.0.0.0/0 or ::/0 should not expose administrative or data ports."
    }
  ],
  "recommendation": "Restrict ingress to approved CIDR ranges, a VPN, or SSM Session Manager."
}
```

## GET /api/v1/runs/{run_id}/report

Returns report markdown, PR comment draft, remediation summary, and transparent risk score object.

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
  "message": "GITHUB_TOKEN is not configured. Would post to example/infra PR #42.",
  "comment_url": null
}
```
