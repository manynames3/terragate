# Demo Script

## 1. Start App

```bash
cd terragate
docker compose -f infra/docker-compose.yml up --build
```

Open http://localhost:3000.

## 2. Launch Or Upload Risky Terraform Plan

Fast public-demo path: click **Try security risk** on the dashboard or use the sample buttons in New Review. This launches a bundled plan through the same backend review workflow without requiring a visitor to upload Terraform JSON.

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

Leave Plan source as Upload existing plan JSON for the standard demo. Sandbox Terraform plan is available only when `TERRAFORM_SANDBOX_ENABLED=true` and code is under the configured sandbox root.

For a PR-native demo, configure a GitHub App webhook to `POST /api/v1/github/webhook`, set `GITHUB_WEBHOOK_SECRET`, and set `GITHUB_WEBHOOK_TERRAFORM_WORKING_DIR` to the local sandbox checkout path template. Opening or synchronizing a PR then queues the same review without manual upload.

## 3. Show Graph Workflow Progress

Open the run detail page. Point out the named workflow nodes:

- Redaction
- Normalization
- Deterministic checks
- Cost delta estimate
- Blast-radius analysis
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
- Linked PR file and redacted patch excerpt when a live GitHub PR context is available.

## 6. Show Remediation

Open remediation snippets in the drawer or PR comment draft. Explain that snippets are generated from structured findings and should be reviewed before applying.

## 7. Show Cost, Blast Radius, and Fix Drafts

Use `risky-cost-plan.json` to show cost delta and policy threshold behavior. Use `destructive-prod-plan.json` to show stateful destructive blast radius and required runbook steps.

On any risky run, open Suggested fix workflow and show that remediation snippets become draft patches. Try Commit to PR before approval to show the API block, then approve the patch. With GitHub credentials on a same-repository PR branch, Commit to PR writes the approved patch block to the branch. Without credentials or on a fork PR, the API returns a clear mock response.

Open a high-risk finding and show Operational checklist. For destructive/stateful resources, point out backup verification, maintenance window, rollback plan, dependency review, owner signoff, and post-apply validation.

## 8. Approve PR Comment

Add a note such as:

```text
Approved for demo after validating public ingress and RDS findings.
```

Click Approve GitHub comment.

## 9. Post or Mock Post to GitHub

Click Post to GitHub. If `GITHUB_TOKEN` is not configured, the API returns a mock response explaining what would have been posted. This shows the integration path without requiring live credentials.

If live GitHub credentials and a PR head SHA are configured, also show the GitHub check status card. Otherwise, point out the stored mock check event.

## 10. Show Run History

Return to the dashboard and show recent runs, risk levels, pending approvals, and mode cards for planned platform expansion.

## 11. Show Team Policy Tuning

Open Settings and show Policy pack workflow. Edit a threshold or required tag in JSON, save it, then explain that future deterministic checks use the updated pack and the audit log records policy updates.
