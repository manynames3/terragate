# Testing And Validation

## TL;DR

The repo has meaningful backend tests and frontend static checks. CI now validates backend migrations, backend tests, frontend type/lint/build, and Terraform fmt/validate. Browser e2e tests remain the biggest testing gap.

## Backend Tests

Run from `apps/api`:

```bash
python -m pytest
```

Current test areas include:

- Terraform plan parsing and redaction
- Deterministic policy checks
- Risk scoring
- API route smoke tests
- Auth behavior
- GitHub integration safety
- PR context mapping
- Production workflow services

## Frontend Checks

Run from `apps/web`:

```bash
npm run typecheck
npm run lint
npm run build
```

These checks catch TypeScript, lint, and Next.js build failures. They do not replace browser e2e coverage.

## Migration Validation

Run from `apps/api`:

```bash
DATABASE_URL=sqlite:///./ci_migrations.db ARTIFACT_STORAGE_DIR=./ci_artifacts alembic upgrade head
```

This catches broken migration chains before tests run.

## Terraform Validation

Run from the repo root:

```bash
terraform fmt -check -recursive infra/terraform
cd infra/terraform/aws-public-demo
terraform init -backend=false -input=false
terraform validate
```

## Manual Smoke Test

1. Start Docker Compose.
2. Upload `sample-data/terraform-plans/risky-security-plan.json`.
3. Confirm the run reaches approval pending.
4. Inspect findings, evidence, runbook checklist, compliance mapping, and PR draft.
5. Confirm GitHub post is rejected before approval.
6. Approve the draft.
7. Confirm GitHub post returns a mock response when credentials are absent or public-demo mode is active.

## Gaps

- Add Playwright or another browser e2e suite for review creation, run detail, approval, runbook, and mock GitHub post.
- Add contract tests for the Cloudflare-hosted frontend against the deployed API.
- Add infrastructure policy scanning if a project dependency such as Checkov or TFLint is adopted.
