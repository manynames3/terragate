# Architecture

## System Overview

CloudOps AI Command Center is a monorepo with a Next.js web app and a FastAPI backend. The backend owns parsing, redaction, deterministic policy checks, LangGraph orchestration, persistence, and external integrations.

```text
Browser
  -> Next.js dashboard
  -> FastAPI /api/v1
  -> LangGraph Terraform review workflow
  -> SQLAlchemy models
  -> PostgreSQL or SQLite dev fallback
  -> Local artifact storage
  -> Optional LangSmith and GitHub
```

## Data Flow

1. User uploads Terraform plan JSON from the web app.
2. API validates the upload and creates a run record.
3. Raw artifact is stored locally and recorded in `artifacts`.
4. If repo owner/name/PR number are provided, the API fetches GitHub PR metadata and changed files and stores them as a `github_pr_context` artifact.
5. LangGraph workflow validates, redacts, normalizes, checks, reviews, merges, remediates, maps compliance, and builds a report.
6. Findings, evidence, remediations, report, PR comment draft, risk score, and graph progress are persisted.
7. UI fetches run detail, findings, report, and stored PR context.
8. User approves or rejects the PR comment draft.
9. Approved runs can post to GitHub, or return a mock response when credentials are missing.

## Backend Graph Workflow

Graph nodes:

- `ingest_plan`: Records input artifacts and run mode.
- `validate_and_redact`: Confirms Terraform plan shape and writes a redacted plan artifact.
- `normalize_resource_changes`: Extracts address, type, provider, actions, before, after, and unknown values.
- `deterministic_policy_checks`: Runs built-in Python policy checks.
- `security_reviewer`: Explains security findings and optionally uses LangChain structured output.
- `cost_reviewer`: Explains cost findings.
- `reliability_reviewer`: Explains destructive and availability findings.
- `governance_reviewer`: Explains tagging, region, profile, and naming findings.
- `merge_findings`: Combines reviewer outputs.
- `deduplicate_and_rank`: Removes duplicates and sorts by severity.
- `generate_remediations`: Adds Terraform snippets.
- `compliance_mapper`: Maps findings to CIS/NIST-style references.
- `report_builder`: Computes risk score and builds the PR comment draft.
- `human_approval_gate`: Sets approval status to pending.
- `github_comment_writer`: No-ops until approved.

## Frontend Pages

- `/`: Home dashboard with command modes and run history.
- `/reviews/new`: Terraform plan upload and review form.
- `/runs/[runId]`: Run detail, risk summary, graph timeline, findings table, drawer, PR comment, and actions.
- `/approvals`: Pending approvals and generated comment review.
- `/settings`: Integration placeholders.

## Database Schema

Core tables:

- `users`: Dev auth placeholder.
- `runs`: Mode, status, environment, risk score, summary, report, draft, graph progress, repo context.
- `artifacts`: Raw and redacted plan references plus GitHub PR context JSON.
- `findings`: Structured finding metadata and routing fields.
- `evidence`: JSON path, observed value, expected value, rule id, explanation.
- `remediations`: Language, snippet, explanation, risk of change.
- `approvals`: Decision and notes.
- `github_comments`: Posted or mock-posted comment records.
