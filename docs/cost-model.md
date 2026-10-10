# Cost Model

## TL;DR

The public demo is designed for low idle cost, not maximum production capability. It uses Cloudflare Workers, request-driven API Gateway/Lambda, and Neon PostgreSQL over TLS outside a VPC, with no NAT gateway. The repository's small stoppable RDS/VPC Terraform stack is an alternative reference, not the live database. No measured monthly bill or zero-idle-cost guarantee is claimed.

## Cost Controls In The Repo

- Request-driven Lambda/API Gateway backend.
- `REVIEW_EXECUTION_MODE=inline` for public-demo sample reviews, avoiding an always-on worker.
- No NAT gateway in the live configuration or reference AWS demo VPC.
- Live managed Neon database; compute/storage/retention cost depends on the configured provider plan and usage, not a verified free-tier claim.
- Reference only: private RDS `db.t4g.micro`, 20 GiB gp3 storage and zero-day backup retention for disposable infrastructure. RDS stop/start does not apply to the hosted Neon database.
- CloudWatch logs retain 14 days.
- ECR has force delete enabled for cleanup.
- GitHub/OpenAI/LangSmith/Infracost calls are optional and disabled or mocked by default in public demo mode.

## Tradeoff

In the reference private-subnet deployment, avoiding a NAT gateway means Lambda cannot reach public APIs without another egress path. The hosted Lambda runs outside a VPC, so this specific egress restriction does not apply. Mocked GitHub writes are an intentional safety guardrail, not a live network limitation.

## Rough Cost Drivers

| Component | Idle behavior |
| --- | --- |
| Cloudflare Workers frontend | Very low for light public-demo traffic |
| API Gateway | Request based |
| Lambda | Request based |
| Neon PostgreSQL (hosted) | Provider-plan, compute, storage and retention dependent; actual charges not measured here |
| RDS PostgreSQL (reference only) | Idle compute/storage cost; stop/start reduces compute but not storage cost |
| CloudWatch logs | Low with 14-day retention and light traffic |
| ECR | Low unless images accumulate |
| NAT Gateway | Not used because it would dominate idle cost |

## Production Cost Changes

Production readiness would likely add:

- Durable queue such as SQS, Step Functions, or Temporal.
- S3 artifact storage with KMS.
- NAT or VPC endpoints for live outbound integrations.
- Real auth resources.
- Monitoring alarms and dashboards.
- Backup retention and deletion protection.

Those additions are appropriate for paid users but intentionally avoided in the public demo path.
