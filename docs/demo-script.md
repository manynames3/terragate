# Demo Script

## 1. Start App

```bash
cd cloudops-ai-command-center
docker compose -f infra/docker-compose.yml up --build
```

Open http://localhost:3000.

## 2. Upload Risky Terraform Plan

Go to New Review and upload:

```text
sample-data/terraform-plans/risky-security-plan.json
```

Use:

- Environment: `prod`
- Cloud provider: `AWS`
- Policy profile: `default`
- Optional GitHub owner/repo/PR: `example`, `infra`, `42`

Click Fetch PR context. With a configured `GITHUB_TOKEN`, the page shows live PR title, changed files, Terraform files, and diff size. Without a token, it shows the safe dev placeholder and the review can still run.

## 3. Show Graph Workflow Progress

Open the run detail page. Point out the named workflow nodes:

- Redaction
- Normalization
- Deterministic checks
- Security/cost/reliability/governance reviewers
- Remediation
- Compliance mapping
- Report builder
- Human approval gate

## 4. Show Severity Table

Use the severity breakdown and findings table. For the risky security sample, highlight:

- Public SSH ingress.
- Public RDS.
- RDS encryption disabled.
- IAM wildcard policy.
- Sensitive value redaction.

## 5. Open Finding Evidence

Click View on a finding. Show:

- JSON path.
- Observed value.
- Expected value.
- Rule ID.
- Explanation.

## 6. Show Remediation

Open remediation snippets in the drawer or PR comment draft. Explain that snippets are generated from structured findings and should be reviewed before applying.

## 7. Approve PR Comment

Add a note such as:

```text
Approved for demo after validating public ingress and RDS findings.
```

Click Approve GitHub comment.

## 8. Post or Mock Post to GitHub

Click Post to GitHub. If `GITHUB_TOKEN` is not configured, the API returns a mock response explaining what would have been posted. This shows the integration path without requiring live credentials.

## 9. Show Run History

Return to the dashboard and show recent runs, risk levels, pending approvals, and mode cards for planned platform expansion.
