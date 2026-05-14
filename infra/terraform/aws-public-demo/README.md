# AWS Public Demo Terraform

## TL;DR

This Terraform stack deploys the TerraGate public-demo backend to AWS:

- API Gateway HTTP API
- Lambda running the FastAPI app through Mangum
- ECR repository for the Lambda container image
- CodeBuild project that builds the image from the public GitHub repo
- Private RDS PostgreSQL in a small VPC
- CloudWatch log groups

It is designed for a portfolio demo, not a multi-tenant SaaS deployment.

## Cost Shape

Idle cost is mostly RDS PostgreSQL. API Gateway, Lambda, ECR, and logs should be low for light demo traffic. To minimize cost, stop the RDS instance when not actively demoing.

## Deploy

```bash
cd infra/terraform/aws-public-demo
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Set `source_revision` to the commit SHA you want CodeBuild to build. The default build clones `main` from `https://github.com/manynames3/terragate.git`.

After apply:

```bash
terraform output api_base_url
curl "$(terraform output -raw api_base_url)/health"
```

Use `api_base_url` as `NEXT_PUBLIC_API_BASE_URL` for the Cloudflare frontend.

## Design Notes

- The Lambda is placed in private subnets so it can reach private RDS without public database access.
- No NAT gateway is created, keeping idle cost down. Public demo settings disable live GitHub/OpenAI calls by default.
- CodeBuild builds the container image remotely, so local Docker is not required.
- Lambda uses `/tmp/artifacts` for demo artifacts. For production, replace this with S3-backed artifact storage.

## Destroy

```bash
terraform destroy
```

The RDS instance has `skip_final_snapshot=true` and `deletion_protection=false` by default because this stack is disposable demo infrastructure.
