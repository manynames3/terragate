# Deployment Guide

## TL;DR

Local development uses Docker Compose. The low-cost public demo deploys the frontend to Cloudflare Workers through OpenNext and the backend to AWS API Gateway/Lambda/RDS through Terraform. CI validates code and Terraform but does not deploy automatically.

## Local Deployment

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Use this for the fullest local workflow because it includes PostgreSQL, API, worker, and web services.

## AWS Public Demo Backend

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

Validated October 7, 2026. This records a specific release, not continuous availability or customer readiness.

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
