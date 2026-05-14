# CloudOps AI Command Center

CloudOps AI Command Center is a production-style AI CloudOps dashboard for reviewing Terraform pull requests before infrastructure changes merge. It parses Terraform plan JSON, redacts sensitive values, runs deterministic security/cost/reliability/governance checks, uses a LangGraph workflow to enrich and rank findings, persists review history, drafts a GitHub PR comment, and requires human approval before posting or committing suggested fixes.

## TL;DR

- **What it is:** An AI-assisted Terraform PR reviewer for cloud/platform teams.
- **What it does:** Turns Terraform plan JSON or sandbox-generated plans into evidence-backed risk findings, remediation guidance, check status, and approval-gated GitHub comments.
- **Why it is credible:** It uses deterministic policy checks first, redacts artifacts before AI review, persists runs/findings/evidence, has Alembic migrations, tests, CI, Docker Compose, GitHub integration, and Cognito-ready auth.
- **Live demo:** No public hosted demo is configured in this repo. The project is demoable locally with Docker Compose and included Terraform plan fixtures.

## About

This project is built for platform engineers, SREs, DevOps teams, and security reviewers who need faster infrastructure change review without trusting an LLM to guess from raw files. The working v1 focuses on the **Review Terraform PR** mode. Other command-center modes are represented in the UI as planned expansion areas.

The core product philosophy is deterministic first, AI second:

1. Parse Terraform plan JSON.
2. Redact sensitive values.
3. Extract normalized resource changes.
4. Run deterministic policy checks.
5. Use reviewer nodes to explain, prioritize, and generate remediation from structured evidence.
6. Require human approval before GitHub writes.

## Tech Stack

| Area | Technology |
| --- | --- |
| Frontend | Next.js 16, React 19, TypeScript, Tailwind CSS, lucide-react |
| Backend API | FastAPI, Pydantic, SQLAlchemy |
| Agent workflow | LangGraph, LangChain, optional OpenAI model calls |
| Database | PostgreSQL in Docker Compose, SQLite fallback for local/manual runs |
| Migrations | Alembic |
| Auth | Dev role-header fallback, Amazon Cognito JWT/Hosted UI integration path |
| Artifact storage | Local filesystem adapter for dev, structured for future object storage |
| GitHub | PR metadata, webhook endpoint, check runs, comments, approved patch commits, mock fallback |
| Cost | Optional Infracost CLI, deterministic heuristic fallback |
| Observability | Optional LangSmith tracing, audit log records in the database |
| Local dev/deploy | Docker Compose, API/web Dockerfiles, GitHub Actions CI |

## Engineering Highlights

- **Terraform-aware parser:** Validates `terraform show -json` output, extracts `resource_changes`, actions, providers, before/after state, and plan summary metrics.
- **Sensitive-data guardrails:** Redacts secret-like keys and PR patch snippets before AI review or artifact display.
- **Deterministic policy engine:** Implements security, cost, reliability, governance, and compliance-style checks with JSON-path evidence.
- **LangGraph workflow:** Runs named review nodes for ingestion, redaction, normalization, policy checks, cost estimate, blast-radius analysis, reviewer enrichment, merge/dedupe, PR mapping, remediation, compliance mapping, reporting, and approval gating.
- **Human-in-the-loop GitHub actions:** PR comments and suggested patch commits are blocked until approved.
- **Production-style persistence:** Stores runs, artifacts, findings, evidence, remediations, approvals, GitHub checks/comments, fix patches, review jobs, and audit events.
- **Async-capable execution:** Supports inline execution, FastAPI background tasks, and a worker process that claims queued review jobs from the database.
- **Operational risk analysis:** Detects destructive stateful changes and generates runbook-grade checklists for backup, maintenance window, rollback, owner signoff, and post-apply validation.
- **Recruiter-visible engineering hygiene:** TypeScript checks, ESLint, pytest suite, Docker Compose, Alembic migrations, sample data, API contract docs, threat model, and ADRs.

## Architecture

The system is a monorepo with a Next.js dashboard and a FastAPI backend. The backend owns Terraform parsing, redaction, policy checks, LangGraph orchestration, persistence, and integrations. The frontend focuses on review intake, run detail, findings, approvals, policy-pack editing, and GitHub action controls.

Architecture docs:

- [Architecture overview and C4-style diagram](docs/architecture.md)
- [Architecture Decision Records](docs/adrs/README.md)
- [API contract](docs/api-contract.md)
- [Threat model](docs/threat-model.md)
- [Demo script](docs/demo-script.md)

## What Works Today

- Upload Terraform plan JSON.
- Optionally run Terraform plan generation from a configured sandbox directory.
- Fetch GitHub PR metadata and changed files when credentials are configured.
- Accept GitHub pull request webhooks for PR-native review triggers.
- Parse and summarize Terraform resource changes.
- Redact raw plan values and GitHub patch context.
- Run deterministic security, cost, reliability, governance, and compliance checks.
- Estimate cost with Infracost when configured, or a labeled heuristic fallback.
- Analyze blast radius for destructive stateful changes.
- Generate structured findings, evidence, remediations, compliance refs, and runbook checklist items.
- Generate a markdown GitHub PR comment draft.
- Require approval before posting comments or committing suggested fixes.
- Persist review history, audit log events, and graph progress.
- Run locally without OpenAI or GitHub credentials using deterministic and mock fallbacks.

## Project Structure

```text
apps/
  api/      FastAPI API, LangGraph workflow, persistence, integrations, tests
  web/      Next.js dashboard, review form, run detail, approvals, settings
docs/       Architecture, ADRs, API contract, threat model, demo script
infra/      Dockerfiles and Docker Compose
sample-data/terraform-plans/
            Safe, risky security, risky cost, and destructive prod plan fixtures
```

## Local Setup

### Option A: Docker Compose

```bash
cd cloudops-ai-command-center
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Open:

- Web: `http://localhost:3000`
- API docs: `http://localhost:8000/docs`

Docker Compose runs PostgreSQL, the API, the worker, and the web app. Optional Redis and Qdrant services are defined behind Compose profiles for future expansion.

### Option B: Manual Local Run

Backend:

```bash
cd cloudops-ai-command-center/apps/api
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Frontend:

```bash
cd cloudops-ai-command-center/apps/web
npm install
npm run dev
```

Manual mode defaults to SQLite if `DATABASE_URL` is empty. Docker Compose uses PostgreSQL. The API runs Alembic migrations on startup; migrations can also be run manually from `apps/api` with `alembic upgrade head`.

## Demo Flow

Use the included sample plans:

```text
sample-data/terraform-plans/safe-plan.json
sample-data/terraform-plans/risky-security-plan.json
sample-data/terraform-plans/risky-cost-plan.json
sample-data/terraform-plans/destructive-prod-plan.json
```

Suggested walkthrough:

1. Start the app.
2. Open New Review.
3. Upload `sample-data/terraform-plans/risky-security-plan.json`.
4. Select `prod`, AWS, and the `default` policy profile.
5. Show graph progress, plan summary, severity breakdown, findings, evidence, remediation, and PR comment draft.
6. Try posting to GitHub before approval to show the approval gate.
7. Approve the draft.
8. Post to GitHub. Without credentials, the API returns a clear mock response.

## Environment

Copy `.env.example` to `.env`. Important variables:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string; SQLite fallback when empty in manual mode |
| `OPENAI_API_KEY` | Enables optional LLM reviewer enrichment |
| `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` | Optional LangSmith tracing |
| `GITHUB_TOKEN` or GitHub App variables | Enables live PR metadata, checks, comments, and approved patch commits |
| `INFRACOST_API_KEY` | Enables stronger Infracost-backed cost estimation |
| `AUTH_MODE` | `dev` or `cognito` |
| `COGNITO_*` and `NEXT_PUBLIC_COGNITO_*` | Cognito JWT validation and Hosted UI login |
| `TERRAFORM_SANDBOX_*` | Optional Terraform plan execution sandbox settings |
| `REVIEW_EXECUTION_MODE` | `inline`, `background`, or worker-backed execution |

For Cognito, create a public app client without a client secret, enable authorization-code + PKCE, add `http://localhost:3000/auth/callback` as an allowed callback URL, and add `http://localhost:3000` as an allowed sign-out URL. Groups map to app roles by default: `cloudops-admins`, `cloudops-reviewers`, and `cloudops-viewers`.

## Generating Terraform Plan JSON

```bash
terraform plan -out=tfplan.binary
terraform show -json tfplan.binary > tfplan.json
```

Terraform plan JSON can expose secrets and provider-generated values. Treat it as sensitive. The app redacts sensitive content before review nodes and before storing GitHub patch context, but raw uploaded artifacts should still be handled as sensitive data.

## Security And Privacy Guardrails

- Raw Terraform plans are never sent to the LLM.
- LLM reviewer nodes receive reduced evidence summaries, not full raw plans.
- Secret-like keys and PR patch snippets are redacted.
- Deterministic findings include concrete evidence and rule IDs.
- Low-confidence or high-risk findings can require human review.
- GitHub comments and suggested patch commits are approval-gated.
- Missing external credentials return mock/dev responses instead of failing the demo.
- Cognito mode validates signed JWTs and maps groups/custom claims to platform roles.

## GitHub Integration

When `repo_owner`, `repo_name`, and `pull_number` are supplied, the backend can fetch PR title, author, state, labels, reviewers, refs, latest head SHA, changed files, and Terraform file patches. Findings are heuristically mapped back to changed Terraform files when context is available.

The app can create GitHub check-run records, draft a single PR comment, post the approved comment, and commit approved suggested patches to same-repository PR branches. If credentials or safe PR metadata are missing, it records mock events and returns clear messages.

## Tests And CI

Backend:

```bash
cd apps/api
source .venv/bin/activate
python -m pytest
```

Frontend:

```bash
cd apps/web
npm run typecheck
npm run lint
npm run build
```

GitHub Actions runs backend pytest plus frontend typecheck, lint, and build.

## Known Limits

- The worker is database-polling, not a durable queue system such as SQS, Celery, or Temporal.
- Terraform sandboxing is useful for demos and trusted local environments, but it is not a hardened multi-tenant SaaS isolation boundary.
- Cost estimates are strongest when Infracost is installed and configured; fallback estimates are intentionally labeled heuristic.
- Suggested patches are reviewable drafts and may need human editing before commit.
- Policy packs are editable JSON files, not yet a full approval/versioning workflow.
- Cognito auth is wired for JWT validation and Hosted UI, but persisted org membership and row-level authorization are future work.

## Roadmap

- Durable queue backend with leases, heartbeats, and node-level retry recovery.
- Tenant-isolated Terraform execution with short-lived cloud credentials.
- Policy-pack approval/versioning workflow.
- S3 artifact storage adapter.
- OPA/Rego policy execution alongside Python checks.
- Chroma/Qdrant runbook retrieval for incident investigation and remediation context.
- LangSmith trace links in the UI.
- AWS ECS/Lambda or Azure Container Apps deployment templates.
