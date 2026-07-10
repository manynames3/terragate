# Operations Runbook

## TL;DR

TerraGate can run locally through Docker Compose or as a low-cost public demo with Cloudflare Workers plus AWS API Gateway/Lambda/RDS. The key operational checks are API health, database connectivity, graph progress, artifact storage, GitHub write approval state, and public-demo guardrails.

## Start Local Stack

```bash
cp .env.example .env
docker compose -f infra/docker-compose.yml up --build
```

Expected services:

- Web: `http://localhost:3000`
- API: `http://localhost:8000`
- API docs: `http://localhost:8000/docs`
- PostgreSQL: internal Compose network
- Worker: claims queued review jobs when `REVIEW_EXECUTION_MODE=worker`

## Validate A Review

1. Open New Review.
2. Upload `sample-data/terraform-plans/risky-security-plan.json`.
3. Select AWS and `prod`.
4. Submit the review.
5. Confirm the run reaches `approval_pending`.
6. Confirm findings include public ingress, public RDS, and IAM wildcard evidence.
7. Confirm PR comment posting is blocked before approval.
8. Approve, then post. Without GitHub credentials, expect a mock response.

## Public Demo Checks

- `PUBLIC_DEMO_MODE=true`
- `PUBLIC_DEMO_DISABLE_SANDBOX=true`
- `PUBLIC_DEMO_MOCK_GITHUB_WRITES=true`
- `PUBLIC_DEMO_ALLOW_LIVE_GITHUB_READS=false`
- `REVIEW_EXECUTION_MODE=inline`
- `AUTH_MODE=dev`

These values keep the hosted demo safe for anonymous visitors.

## Failure Modes

| Symptom | Likely cause | Recovery |
| --- | --- | --- |
| Review stuck queued | Worker not running, or inline/background mode mismatch | Check `REVIEW_EXECUTION_MODE`; start `python -m app.worker` or use inline/background mode. |
| Upload rejected | Public demo upload cap or invalid plan shape | Use bundled sample review or a valid `terraform show -json` plan under the size limit. |
| GitHub post mocked | Missing token/App credentials or public demo mock setting | Configure GitHub credentials for private deployments; keep mock on for public demo. |
| Cost estimate is rough | Infracost unavailable | Install/configure Infracost for private deployments or treat heuristic output as directional only. |
| Lambda cannot call external APIs | Public demo VPC has no NAT gateway | Keep demo mocked, or add an egress path and accept the idle cost/security tradeoff. |
| RDS unavailable | Instance stopped for cost control | Start the instance before demoing, then confirm API health. |

## Rollback And Recovery

- Application code rollback: deploy a previous Git ref through the Terraform `git_ref` / `source_revision` variables and rebuild the Lambda image.
- Frontend rollback: redeploy a previous Cloudflare Worker build from the desired Git ref.
- Database rollback: Alembic supports schema upgrades; production-grade rollback would require tested downgrade paths and backups. The public demo RDS defaults are disposable and do not keep backups.
- Review data recovery: local/dev artifacts are filesystem-based; Lambda demo artifacts are ephemeral. Production should use S3/KMS with retention policies.

## Maintenance Window Checklist

- Confirm the target Git ref and environment variables.
- Run CI checks locally or on GitHub.
- Apply Terraform changes for backend infrastructure.
- Deploy Cloudflare frontend with the API base URL.
- Run `/health` and a bundled sample review.
- Validate approve/post mock behavior before sharing the demo.
