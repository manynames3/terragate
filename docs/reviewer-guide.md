# Reviewer Guide

## TL;DR

Start with the README, then inspect the LangGraph workflow, policy checks, database models, tests, Terraform stack, and CI workflow. The strongest signal is not the UI alone; it is the deterministic-first review pipeline with redaction, persistence, approval gates, audit events, and honest deployment tradeoffs.

## What This Project Proves

- Can design a cloud/platform workflow around real operational risk instead of a generic chatbot.
- Can separate deterministic evidence from optional AI explanation.
- Can build full-stack product surfaces: Next.js dashboard, FastAPI API, database persistence, and GitHub integration.
- Can reason about sensitive artifact handling, human approval, auditability, and low-idle deployment cost.
- Can document tradeoffs without overclaiming production maturity.

## Files To Inspect First

| Area | Files |
| --- | --- |
| Product summary | `README.md`, `docs/product-readiness.md`, `docs/demo-script.md` |
| Architecture | `docs/architecture.md`, `docs/architecture-notes.md`, `docs/architecture_aws.py`, `docs/architecture.mmd` |
| Frontend | `apps/web/app`, `apps/web/components`, `apps/web/lib/api.ts`, `apps/web/wrangler.jsonc` |
| Backend/API | `apps/api/app/main.py`, `apps/api/app/routes/terraform_reviews.py`, `apps/api/app/schemas/review.py` |
| Review workflow | `apps/api/app/graph/terraform_review/graph.py`, `apps/api/app/graph/terraform_review/nodes` |
| Policy and risk | `apps/api/app/services/terraform_plan.py`, `apps/api/app/services/risk.py`, `apps/api/app/services/blast_radius.py`, `apps/api/app/policies/policy_packs` |
| Persistence | `apps/api/app/models/entities.py`, `apps/api/alembic/versions` |
| Integrations | `apps/api/app/integrations/github.py`, `apps/api/app/services/github_context.py`, `apps/api/app/services/cost_estimator.py` |
| Infrastructure | `infra/docker-compose.yml`, `infra/terraform/aws-public-demo`, `infra/Dockerfile.lambda` |
| CI/testing | `.github/workflows/ci.yml`, `apps/api/app/tests`, `apps/web/package.json` |
| Operations | `docs/runbook.md`, `docs/security.md`, `docs/observability.md`, `docs/cost-model.md`, `docs/teardown.md`, `docs/tradeoffs.md` |

## How To Run Or Inspect

Local full stack:

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Backend tests:

```bash
cd apps/api
python -m pytest
```

Frontend checks:

```bash
cd apps/web
npm test
npm run typecheck
npm run lint
npm run build
```

Terraform validation:

```bash
terraform fmt -check -recursive infra/terraform
cd infra/terraform/aws-public-demo
terraform init -backend=false
terraform validate
```

## Strongest Engineering Decisions

- Deterministic checks create findings before any LLM reviewer node runs.
- Raw Terraform plans are not sent to optional LLM calls; reduced redacted evidence is used instead.
- GitHub writes are approval-gated and audited.
- Review history, findings, evidence, remediation, approvals, jobs, and graph progress are persisted.
- Public demo mode is explicit about disabled live writes, sandbox execution, and policy edits.
- Low-idle deployment uses request-driven Lambda/API Gateway and avoids a NAT gateway.

## Tradeoffs And Incomplete Areas

- The public demo uses dev auth; Cognito support exists but is not provisioned by demo Terraform.
- The worker is database-polling, not SQS/Temporal/Celery.
- Lambda artifact storage is ephemeral; S3/KMS is the production direction.
- Terraform sandboxing is not a hardened multi-tenant execution boundary.
- Policy packs are editable files, not a full approval/versioning workflow.
- Frontend checks cover a focused regression test plus type/lint/build; browser e2e tests are still a gap.
