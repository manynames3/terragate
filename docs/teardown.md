# Teardown And Cleanup

## TL;DR

The local stack is disposable. The AWS public-demo stack is also designed to be disposable, with no deletion protection and no final RDS snapshot by default. This keeps demo cleanup simple but would not be acceptable for production customer data.

## Local Cleanup

```bash
docker compose -f infra/docker-compose.yml down
```

To remove local volumes as well:

```bash
docker compose -f infra/docker-compose.yml down -v
```

Remove local artifacts and SQLite databases only when you no longer need local run history:

```bash
rm -rf artifacts test_artifacts
rm -f *.db *.sqlite *.sqlite3 apps/api/*.db apps/api/*.sqlite apps/api/*.sqlite3
```

## AWS Public Demo Cleanup

```bash
cd infra/terraform/aws-public-demo
terraform destroy
```

The stack sets:

- `skip_final_snapshot=true`
- `db_deletion_protection=false`
- ECR `force_delete=true`
- 14-day CloudWatch log retention

This favors cleanup speed for demo infrastructure. Production should enable backup retention, deletion protection, and intentional data export before teardown.

## Cloudflare Cleanup

Use Wrangler or the Cloudflare dashboard to remove the Worker if it is no longer needed. The repo does not currently automate Cloudflare teardown through Terraform.

## Secrets And State Cleanup

- Do not commit `.env`, `.env.*`, `terraform.tfvars`, or Terraform state.
- Remove local `terraform.tfstate` only after confirming the cloud stack is destroyed or state has been moved.
- Rotate any GitHub/OpenAI/LangSmith/Infracost credentials that were used in a public demo environment.
