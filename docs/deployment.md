# Deployment Guide

## TL;DR

Local development uses Docker Compose. The hosted public demo uses Cloudflare Workers/OpenNext, AWS API Gateway/Lambda, and Neon PostgreSQL over TLS. The repository's Terraform RDS/VPC stack is a reference deployment, not the live inventory. CI validates code and Terraform but does not deploy automatically.

## Local Deployment

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Use this for the fullest local workflow because it includes PostgreSQL, API, worker, and web services.

## AWS Public Demo Backend

**Reference stack:** The commands below provision the RDS/VPC alternative. Do not run `terraform apply` against the existing hosted demo without reconciling the live Neon/outside-VPC configuration. The current release process updates the existing Lambda by an exact ECR image digest built by CodeBuild; it does not provision replacement database/network resources.

```bash
cd infra/terraform/aws-public-demo
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan
terraform apply
terraform output api_base_url
```

The Terraform stack provisions:

- VPC with private subnets
- Lambda security group
- Private encrypted RDS PostgreSQL
- ECR repository
- CodeBuild project to build the Lambda image
- Lambda container function
- API Gateway HTTP API
- CloudWatch log groups

The backend container entrypoint is `app.lambda_handler.handler` through Mangum.

## Cloudflare Frontend

```bash
cd apps/web
NEXT_PUBLIC_API_BASE_URL=https://your-api.execute-api.us-east-1.amazonaws.com \
NEXT_PUBLIC_AUTH_PROVIDER=dev \
npm run deploy:cloudflare
```

The repo uses `@opennextjs/cloudflare` and `wrangler.jsonc`. Frontend deployment is manual in this repo.

## GitHub App Setup Path

The code supports GitHub token/App-style configuration, PR metadata reads, webhooks, automatic checks, and versioned approval-gated comments. Generated remediation is export-only; automatic source-verified patch generation is not implemented. A production onboarding flow should:

1. Create a GitHub App with pull request read, checks write, contents write, and metadata read permissions.
2. Register the webhook URL `/api/v1/github/webhook`.
3. Store installation ID and repository mapping to the customer organization.
4. Configure `GITHUB_APP_ID`, `GITHUB_APP_INSTALLATION_ID`, `GITHUB_APP_PRIVATE_KEY_PATH`, and `GITHUB_WEBHOOK_SECRET`.
5. Run a PR opened/synchronized event and verify check status plus a review URL.

The public demo keeps GitHub writes mocked by default.

## CI/CD Boundaries

GitHub Actions validates:

- Backend dependency install
- Alembic migrations
- Backend tests
- Frontend typecheck/lint/build
- Terraform fmt and validate

It does not run `terraform apply` or deploy Cloudflare Workers. That is deliberate so public pull requests cannot mutate cloud resources.

## Verified Public Demo Release

These records describe specific releases, not continuous availability or customer readiness.

### Workspace And Stratum Release: October 10, 2026

| Release component | Evidence |
| --- | --- |
| Backend/workspace revision | `42902e4a5d709e038b857669e65311b00fbbb652`, merged through [PR #6](https://github.com/manynames3/terragate/pull/6); main merge `8ff7d86d751dc8c4e335240343a949f018aef2b5` |
| CI | [Run 38027392087](https://github.com/manynames3/terragate/actions/runs/38027392087) passed backend, frontend and infrastructure checks, including disposable PostgreSQL migration preservation |
| AWS image build | CodeBuild `terragate-demo-lambda-image:67915d74-0923-4ec9-b3fd-e7eca1af6525` succeeded after checking out the exact application revision |
| Lambda image | `sha256:ca93d599a8a15964ceb6ae6207b548b3a1ab64a8438d962f7da49f01eba3f3df`; `terragate-demo-api` reported Active / Successful |
| Database | Neon PostgreSQL 18.6 over TLS, Lambda outside a VPC; revision `0009_review_workspace`, 64 pre-existing runs retained before smoke-test fixtures |
| Recovery rehearsal | A hosted-database backup was restored into isolated local PostgreSQL; upgrade/downgrade/re-upgrade preserved row digests across all 13 existing tables |
| Frontend compatibility revision | `fe1acc0d263cc4f506696b2df14def98bde543e2`, Next.js 16.3.8 / OpenNext 1.20.10; see [PR #7](https://github.com/manynames3/terragate/pull/7) |
| Cloudflare Worker | `terragate`, version `e314fdeb-d21f-499c-ba02-3cd75c6f205d`; `/overview` returned HTTP 200 after local Worker-runtime verification |
| Readiness | Deployed API `/ready` returned HTTP 200 with the database reachable |

The initial Next.js 16.4 bundle returned HTTP 500 despite a successful build. It was rolled back before deploying the compatible frontend; the new CI Worker-runtime smoke checks the failure boundary. AWS's account quota refused a temporary reserved-concurrency setting, so concurrency remained unchanged. The schema migration nevertheless completed successfully; concurrent migration execution is not validated.

Hosted Playwright verification passed against the exact public demo URLs using repository fixtures and dev identities. Example: [run_487486f288034160a3](https://terragate.hangi87.workers.dev/runs/run_487486f288034160a3).

- Real safe/cost/security plan uploads, safe score zero, redacted plan evidence and saved-snippet export.
- Full-row keyboard navigation; independent administrator approval of a finding-scoped exception reduced blockers without changing raw risk or approving the comment.
- Separate comment approval, confirmed mock posting, repeat-post prevention, and persisted exception audit history.
- Navigation pages, search empty state, simulated HTTP 503 stale/retry state, and desktop/tablet/mobile overflow checks.
- Stratum SVG branding at desktop/mobile sizes, SVG favicon, and mobile navigation Escape/focus restoration; no browser page errors.

The final journey retrieved its redacted plan successfully. An earlier attempt reproduced the real ephemeral-artifact limitation with HTTP 410; later success does not remove that limitation. Hosted screenshots were inspected separately; README screenshots remain the labelled local captures.

No infrastructure was provisioned or Terraform applied. The existing live Neon/outside-VPC configuration was preserved; the repository's RDS/VPC Terraform reference must be reconciled before a future apply. Findings, approvals and audit history persist in PostgreSQL, but raw/redacted plan files in Lambda `/tmp` do not survive instance changes. An expired plan returns HTTP 410; this is not durable artifact storage. Public-demo auth remains shared/dev, GitHub writes mocked, costs heuristic, sandbox execution disabled, and private Cognito/live GitHub integrations unverified.

### Earlier Release: October 7, 2026

| Release component | Evidence |
| --- | --- |
| Application revision | `5e9675f94eb3d54c31911b25ef9974b88a0db038`, merged through [PR #4](https://github.com/manynames3/terragate/pull/4) after backend/frontend/infrastructure CI passed |
| AWS image build | CodeBuild `terragate-demo-lambda-image:e0761488-8bfc-4b55-8a38-06ac45d083f2`, succeeded; one-off buildspec checked out the exact revision rather than a moving branch |
| Lambda image digest | `sha256:6c9d41706e6dceb85d5e1e6fec86995162a9d8618cb5b87dabe9c06e106ddb26`; `terragate-demo-api` reported Active / Successful |
| Database migration | CloudWatch recorded PostgreSQL migration `0007_run_org_scope` to `0008_review_approval_provenance` |
| Cloudflare Worker | `terragate`, version `bb00265a-815f-4387-8019-661be2bcdb2d`; OpenNext production bundle deployed successfully |

Hosted verification covered:

- Safe/security/cost/destructive sample reviews returned distinct risk scores of 0/82/65/96, with API detail/report consistency. Cost estimates were explicitly `heuristic_fallback`, not measured cloud bills.
- Unapproved posting and stale snapshot approval returned HTTP 409. Current approval permitted a mock post; repeat requests did not create another external action.
- JSON plan upload completed. Generated remediations remained export-only snippets.
- Desktop/mobile Playwright smoke confirmed the displayed PR draft and downloaded snippet matched API content, approval and post confirmation worked, repeat posting was disabled, and there were no page errors or mobile page overflow.
- The hosted overview returned HTTP 200. An example verified run is [run_d00bc8ceb1ed4b7f81](https://terragate.hangi87.workers.dev/runs/run_d00bc8ceb1ed4b7f81).

No live GitHub writes, private Cognito deployment, hardened Terraform execution, or Infracost-backed pricing were exercised. Public-demo writes remain mocked. Known dependency advisories, dev-auth/shared visibility, ephemeral artifact storage, and durable-worker gaps remain. This release updated existing services without adding infrastructure; Terraform still owns their configuration, and future plans must be reviewed for image-digest drift.
