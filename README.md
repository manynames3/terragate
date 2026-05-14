# CloudOps AI Command Center

A production-style AI CloudOps platform for reviewing infrastructure changes before they land. The v1 implementation focuses on a functional Terraform PR Reviewer: upload a Terraform plan JSON file, run a LangGraph workflow, get deterministic infrastructure risk findings, review remediation snippets, approve the generated PR comment, and optionally post it to GitHub.

This is intentionally not a toy chatbot. The system parses Terraform plan JSON, redacts sensitive values, runs deterministic policy checks first, and only uses AI as an explanation/remediation layer when `OPENAI_API_KEY` is configured. Without credentials, the app still works locally with deterministic fallback behavior.

## Why It Matters

Cloud infrastructure reviews are high-risk because Terraform plans can destroy stateful resources, expose databases, create large recurring costs, or leak secrets through plan artifacts. A useful AI CloudOps tool needs evidence and guardrails before language generation.

This project demonstrates:

- Deterministic policy checks before LLM reasoning.
- Sensitive value redaction before any AI call.
- Transparent risk scoring.
- Human approval before external GitHub posting.
- Persistent run history, findings, evidence, remediations, and approvals.
- Clean adapters for GitHub, LangSmith, local artifact storage, and future vector search.

## Architecture

```text
apps/web       Next.js dashboard, upload flow, findings table, approval center
apps/api       FastAPI backend, SQLAlchemy/Alembic persistence, LangGraph workflow
postgres       Run history, findings, evidence, approvals, GitHub comments
artifacts      Raw/redacted Terraform plans on local filesystem for dev
LangSmith      Optional tracing through environment variables
GitHub API     Optional approved PR comment posting
```

Screenshots placeholders:

- Home dashboard: command modes and recent run history.
- New Terraform review: upload form with sensitive data warning.
- Run detail: risk score, graph progress, findings, evidence, remediation.
- Approval center: generated PR comment with approve/reject/post controls.

## Implemented V1

- Upload Terraform plan JSON.
- Parse `resource_changes` from `terraform show -json`.
- Redact keys containing `password`, `secret`, `token`, `api_key`, `access_key`, `private_key`, `credential`, `auth`, and `cert`.
- Extract plan summary: creates, updates, deletes, replacements, resource types, providers.
- Run named LangGraph nodes:
  `ingest_plan`, `validate_and_redact`, `normalize_resource_changes`, `deterministic_policy_checks`, `security_reviewer`, `cost_reviewer`, `reliability_reviewer`, `governance_reviewer`, `merge_findings`, `deduplicate_and_rank`, `map_github_pr_context`, `generate_remediations`, `compliance_mapper`, `report_builder`, `human_approval_gate`, `github_comment_writer`.
- Produce structured findings with severity, category, resource, evidence, recommendation, remediation, compliance refs, source, reviewer node, confidence, and human-review flag.
- Map findings to changed Terraform PR files and redacted patch excerpts when live GitHub context is available.
- Save runs, artifacts, findings, evidence, remediations, approvals, and GitHub comment records.
- Manage schema changes with Alembic migrations instead of `create_all()`.
- Generate a markdown PR comment draft.
- Refuse GitHub posting until the run is approved.
- Fetch live GitHub PR metadata and changed files when repo context and `GITHUB_TOKEN` are configured.
- Return a clear mock/dev GitHub response when credentials or PR metadata are missing.

## Local Setup

### Option A: Docker Compose

```bash
cd cloudops-ai-command-center
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Open:

- Web: http://localhost:3000
- API docs: http://localhost:8000/docs

### Option B: Run Services Manually

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

Manual mode defaults to SQLite if `DATABASE_URL` is empty. Docker Compose uses PostgreSQL. The API runs Alembic migrations on startup; you can also run them manually from `apps/api` with `alembic upgrade head`.

## Environment Variables

See `.env.example`.

```bash
DATABASE_URL=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.4-mini
LANGSMITH_API_KEY=
LANGSMITH_PROJECT=cloudops-ai-command-center
LANGSMITH_TRACING=true
GITHUB_TOKEN=
ARTIFACT_STORAGE_DIR=./artifacts
APP_ENV=development
NEXT_PUBLIC_API_BASE_URL=http://localhost:8000
```

## Generate Terraform Plan JSON

```bash
terraform plan -out=tfplan.binary
terraform show -json tfplan.binary > tfplan.json
```

Terraform plan JSON can expose secrets and provider-generated values. Treat it as sensitive.

## Demo

Use the included sample data:

```text
sample-data/terraform-plans/safe-plan.json
sample-data/terraform-plans/risky-security-plan.json
sample-data/terraform-plans/risky-cost-plan.json
sample-data/terraform-plans/destructive-prod-plan.json
```

Recommended demo path:

1. Start the app.
2. Go to New Review.
3. Upload `sample-data/terraform-plans/risky-security-plan.json`.
4. Select `prod`, AWS, default policy.
5. Show graph progress, risk score, findings table, evidence drawer, remediation snippets, and PR comment draft.
6. Try posting to GitHub before approval to see the block.
7. Approve the draft.
8. Post to GitHub. Without `GITHUB_TOKEN`, the API returns a mock response explaining what would have been posted.

## Security Guardrails

- Full raw plans are never sent to the LLM.
- Suspicious keys are redacted before AI review.
- GitHub PR patch snippets are redacted and truncated before persistence.
- Deterministic findings include concrete JSON-path evidence.
- LLM reviewers are instructed not to invent findings and only operate on reduced evidence summaries.
- GitHub posting is impossible unless `approval_status == approved`.
- Missing GitHub credentials produce a safe mock response instead of failing the demo.

## Human Approval Workflow

The graph produces a PR comment draft and stops in `approval_pending`. The API exposes:

- `POST /api/v1/runs/{run_id}/approve`
- `POST /api/v1/runs/{run_id}/reject`
- `POST /api/v1/runs/{run_id}/github-comment`
- `GET /api/v1/github/pr-context`

Only approved runs can call the GitHub comment endpoint.

## GitHub PR Integration

When `repo_owner`, `repo_name`, and `pull_number` are supplied, the backend attempts to fetch:

- PR title, author, state, draft status, labels, reviewers, base/head refs, URL, and latest head SHA.
- Changed files, additions/deletions, and truncated patches.
- Terraform-specific files (`.tf`, `.tfvars`, or paths containing `terraform`).

The PR context is saved as a redacted `github_pr_context` artifact and displayed on the run detail page. During review, `map_github_pr_context` heuristically links each finding to the changed Terraform file and patch excerpt that best matches its resource address/type. The New Review page can also preview PR context before submission. If `GITHUB_TOKEN` is missing, the endpoint returns a structured dev placeholder instead of failing the review.

## Roadmap

- GitHub PR webhook ingestion.
- Cost estimate integration with Infracost or cloud pricing APIs.
- OPA/Rego policy execution alongside Python checks.
- Clerk or Auth.js production auth.
- S3 artifact storage adapter.
- Chroma/Qdrant runbook retrieval for incident investigation and remediation context.
- LangSmith trace links in the UI.
- AWS ECS/Lambda or Azure Container Apps deployment templates.
