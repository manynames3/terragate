# Testing And Validation

## TL;DR

The repo has backend tests, focused frontend regressions, static checks, and a checked-in local browser smoke test. CI validates SQLite migrations plus PostgreSQL 17 legacy-data preservation, backend tests, frontend test/type/lint/build, and Terraform fmt/validate. The browser smoke is not yet part of CI and does not prove private/cloud integration readiness.

## Workspace Validation Record

Local validation on **2026-10-10**, on `feature/enterprise-review-workspace`; no production release was made:

| Check | Observed result |
| --- | --- |
| Backend `python -m pytest -q` with isolated `TEST_POSTGRES_URL` | 97 passed, including SQLite and PostgreSQL preservation; two upstream deprecation warnings |
| Frontend `npm test` | 5 passed |
| Frontend typecheck and lint | Passed |
| Next.js production build | Passed on 16.4.0 |
| OpenNext Cloudflare build | Passed locally with the existing 1.19.10 adapter; bundle only, no deployment |
| Playwright workspace smoke | Passed against isolated loopback API/UI; no page errors or page overflow at desktop/tablet/mobile widths |
| Screenshots | Actual local captures in `docs/screenshots`; inspected desktop/mobile queue and finding views |
| `npm audit --omit=dev` | 0 reported vulnerabilities after existing-package updates |
| Full `npm audit` | 18 reported tooling vulnerabilities: 14 high, 1 moderate, 3 low; not a clean audit |
| PostgreSQL migration preservation | Passed on local PostgreSQL 17 with an isolated database; concurrency/locking not validated |
| Hosted-database backup rehearsal | PostgreSQL 18.6 backup restored locally; upgrade/downgrade/re-upgrade preserved all existing data across 13 tables, including 64 runs |

The browser smoke uses dev identities, repository fixtures, and mocked GitHub writes. Private Cognito login, GitHub installations/live writes, worker crash recovery, cloud releases and persistent object storage remain unverified. The audit totals are a dated observation, not a security guarantee; rerun after dependency changes. No Terraform infrastructure changed or was applied.

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
- Organization isolation and membership-based roles
- Expiring snapshot-bound exceptions, different-admin decisions, denial/revocation/staleness
- Policy/rule provenance and nullable unassessed/failed results
- Terraform sensitivity masks, unknown inputs and strict malformed-change validation
- Artifact boundaries, permissions, digest validation and filename collision prevention
- Webhook HMAC validation and fail-closed configuration
- Liveness/database readiness and request IDs
- Preflight artifact failure recorded as failed rather than stuck running; GitHub check transport errors do not destroy completed assessments

## Frontend Checks

Run from `apps/web`:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

These checks cover approval eligibility, stale/mismatched drafts, and the absence of frontend scenario enrichment, plus TypeScript, lint, and Next.js build failures. They do not replace browser e2e coverage.

Backend approval regressions cover incomplete reviews, changed draft/artifact/policy/head/score, actor persistence, rejection, exact draft posting, repeat-post handling, and patch tampering. GitHub transport tests do not use real credentials. Real patch application tests run Git plus `terraform fmt -check` when both binaries are installed; otherwise those integration cases are explicitly skipped. They verify replacement (not append), stale context, and invalid syntax. PostgreSQL concurrency and full module validation remain gaps.

## Migration Validation

Run from `apps/api`:

```bash
DATABASE_URL=sqlite:///./ci_migrations.db ARTIFACT_STORAGE_DIR=./ci_artifacts alembic upgrade head
```

This catches broken migration chains before tests run.

Migration tests preserve existing review/draft/patch data through upgrade to head and downgrade. `0009` keeps expanded identity widths on downgrade to avoid truncating Cognito subjects. The same preservation case runs against PostgreSQL when `TEST_POSTGRES_URL` points to an **empty isolated test database**, as configured by CI's disposable PostgreSQL service. Never point it at a live database: the test creates fixtures and downgrades the schema. Concurrent locking/worker recovery is not validated by these tests.

## Local Browser Smoke

Use an **isolated local database/artifact directory**, no external credentials, and `PUBLIC_DEMO_MODE=true`, `REVIEW_EXECUTION_MODE=inline`, `PUBLIC_DEMO_MOCK_GITHUB_WRITES=true`. Start the API on 8010 with CORS allowing `http://localhost:3040`. Build/start the frontend with `NEXT_PUBLIC_API_BASE_URL=http://localhost:8010` on 3040.

Run from `apps/web`:

```bash
npm exec --yes --package=playwright -- playwright install chromium
SMOKE_WEB=http://localhost:3040 SMOKE_API=http://localhost:8010 \
  npm exec --yes --package=playwright -- node e2e/review-workspace.cjs
```

Playwright is temporary tooling, not a new application dependency. The test refuses non-loopback endpoints and a non-demo API. It creates real local fixture reviews, checks the API's assessment/draft/download, requests an exception, uses a separate dev identity to accept it, verifies unchanged raw risk and separate comment approval, performs a mock post, and inspects audit records. It also tests navigation, empty/error/stale states, row keyboard activation, mobile menu Escape/focus return and page overflow at 1440, 834, and 390px widths.

Screenshots default to `/private/tmp/terragate-enterprise-screenshots`; `SMOKE_SCREENSHOTS` changes the output directory. Screenshots in `docs/screenshots` are from this running local UI with sample plans, not mockups or production evidence. The test is not an exhaustive WCAG audit and does not verify real GitHub writes, Cognito Hosted UI, Infracost pricing, worker crash recovery, or PostgreSQL locking.

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

- Run the checked-in browser smoke reproducibly in CI; add deeper runbook-progress, private-login, webhook replay and worker recovery cases.
- Add contract tests for the Cloudflare-hosted frontend against the deployed API.
- Add infrastructure policy scanning if a project dependency such as Checkov or TFLint is adopted.
