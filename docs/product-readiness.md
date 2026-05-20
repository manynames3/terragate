# Product Readiness Plan

## TL;DR

TerraGate is demo-ready as a hosted Terraform PR risk gate. It should not be sold as self-serve SaaS until private-repo onboarding, tenant-scoped auth, artifact retention controls, and paid-plan boundaries are production-ready. The fastest chargeable path is a guided paid pilot for GitHub + Terraform + AWS teams.

## Current Sellable Wedge

TerraGate should be positioned as a focused Terraform PR risk gate, not a broad CloudOps command center. The strongest buyer-facing promise is:

> Catch risky Terraform changes before merge with deterministic evidence, remediation, runbook checklists, and approval-gated GitHub actions.

Best first users:

- Platform engineers reviewing Terraform PRs.
- Cloud security engineers responsible for IaC guardrails.
- DevOps teams without a mature Terraform review workflow.

Best first buyers:

- Head of Platform.
- Cloud Security Lead.
- DevOps or Infrastructure Engineering Manager.

## What Is Demo-Ready Today

- Hosted sample reviews with no private artifact upload required.
- Terraform plan JSON upload path.
- Terraform-aware parsing, redaction, policy checks, and risk scoring.
- LangGraph review workflow with named graph progress.
- GitHub PR metadata and patch-context adapter.
- Approval-gated PR comment and fix-patch workflows.
- Runbook and compliance views generated from review evidence.
- Audit log and approval history for each run.
- Initial organization-scoped run access for authenticated users.
- Public-demo safeguards for sandboxing, policy edits, and GitHub writes.

## Gaps Before Self-Serve Paid Use

### P0: Trust And Access Control

- Require real auth outside local development.
- Finish organization/tenant scoping with a first-class organization model, policy-pack ownership, and GitHub installation-to-org mapping.
- Show current user/org and deployment mode in the UI.
- Add customer-visible artifact retention and delete controls.

### P0: Turnkey GitHub Activation

- Provide a clear GitHub App installation path.
- Store installed repositories and selected policy profile per repo.
- Run automatically on PR opened/synchronized events.
- Display check status, review URL, and failure reason back in GitHub.

### P0: Paid Pilot Boundary

- Add an explicit plan model, even if billing starts manually.
- Enforce review/repo limits by plan.
- Keep public sample reviews free.
- Make private repo automation, GitHub writes, policy packs, audit export, and retention controls paid-only.

### P1: Review Quality And Retention

- Version policy packs and store the exact policy version used for each run.
- Add rule suppression or accepted-risk comments to reduce repeated false positives.
- Improve suggested patches so they are diff-based, file-aware, and validated against the latest PR head SHA.
- Add Slack or email notification after high-risk reviews.

### P1: Operational Reliability

- Replace DB-polling workers with SQS, Celery, Step Functions, or Temporal when moving beyond low-volume pilots.
- Add dead-letter states, retry metadata, and customer-visible failure explanations.
- Add frontend end-to-end tests for review creation, approval, runbook progress, and GitHub mock posting.

## What To Avoid For Now

- Do not broaden the product into general incident investigation yet.
- Do not sell multi-cloud coverage before AWS/Terraform/GitHub is excellent.
- Do not add a generic AI chat interface.
- Do not run arbitrary Terraform for anonymous public users.
- Do not claim enterprise compliance readiness until tenant isolation, retention, audit export, and policy versioning are complete.

## 14-Day Chargeable Pilot Scope

Goal: one private customer can connect one GitHub org/repo, run TerraGate on Terraform PRs, and pay for a guided pilot.

Build:

1. Org-scoped auth and data access.
2. GitHub App install and repository registration.
3. PR webhook review trigger with check-run status.
4. Artifact retention and delete controls.
5. Paid-plan limits or manual pilot entitlement.
6. Policy version snapshots.
7. Improved PR file mapping for findings.
8. First-run onboarding and private deployment setup docs.

Cut:

- Incident mode.
- Broad cost optimization mode.
- Public sandbox execution.
- Enterprise SSO beyond the chosen auth provider.
- Full compliance reporting beyond evidence mapping.

Ready to charge means:

- A new technical customer can connect a repo without live support.
- A Terraform PR produces a review, findings, check status, and approval-gated comment.
- Customer data is tenant-scoped and has documented retention/deletion behavior.
- The product can explain exactly what data is sent to AI and what is not.
