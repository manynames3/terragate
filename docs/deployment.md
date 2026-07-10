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

The code supports GitHub token/App-style configuration, PR metadata reads, webhooks, checks, comments, and approval-gated patch commits. A production onboarding flow should:

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
