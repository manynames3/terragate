# AWS Public Demo Terraform

## TL;DR

This Terraform stack deploys the TerraGate public-demo backend to AWS:

- API Gateway HTTP API
- Lambda running the FastAPI app through Mangum
- ECR repository for the Lambda container image
- CodeBuild project that builds the image from the public GitHub repo
- External PostgreSQL, such as Neon Free, supplied through `database_url`
- CloudWatch log groups

It is designed for a portfolio demo, not a multi-tenant SaaS deployment.

## Cost Shape

Idle AWS cost should be low for light demo traffic because the stack no longer creates RDS or VPC resources. Database cost is controlled by the external PostgreSQL provider; Neon Free is a good fit for a tiny public demo.

## Deploy

```bash
cd infra/terraform/aws-public-demo
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform apply
```

Set `source_revision` to the commit SHA you want CodeBuild to build. Set `database_url` to a direct external PostgreSQL connection string. The default build clones `main` from `https://github.com/manynames3/terragate.git`.

After apply:

```bash
terraform output api_base_url
curl "$(terraform output -raw api_base_url)/health"
```

Use `api_base_url` as `NEXT_PUBLIC_API_BASE_URL` for the Cloudflare frontend.

## Design Notes

- Lambda runs without a VPC attachment so it can reach an external PostgreSQL provider over the public internet.
- No VPC, NAT gateway, or RDS instance is created, keeping idle AWS cost down. Public demo settings disable live GitHub/OpenAI calls by default.
- CodeBuild builds the container image remotely, so local Docker is not required.
- Lambda uses `/tmp/artifacts` for demo artifacts. For production, replace this with S3-backed artifact storage.

## Destroy

```bash
terraform destroy
```
