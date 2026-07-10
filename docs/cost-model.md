# Cost Model

## TL;DR

The public demo is designed for low idle cost, not maximum production capability. It uses Cloudflare Workers for the UI, API Gateway and Lambda for request-driven backend execution, no NAT gateway, short log retention, and a small RDS instance that can be stopped outside demos.

## Cost Controls In The Repo

- Request-driven Lambda/API Gateway backend.
- `REVIEW_EXECUTION_MODE=inline` for public-demo sample reviews, avoiding an always-on worker.
- No NAT gateway in the AWS demo VPC.
- Private RDS `db.t4g.micro` default with 20 GiB gp3 storage.
- RDS backup retention defaults to zero days for disposable demo infra.
- CloudWatch logs retain 14 days.
- ECR has force delete enabled for cleanup.
- GitHub/OpenAI/LangSmith/Infracost calls are optional and disabled or mocked by default in public demo mode.

## Tradeoff

Avoiding a NAT gateway keeps idle cost low but means Lambda cannot reach public APIs from private subnets unless an egress path is added. The current public demo intentionally favors safe mock behavior over live external integrations.

## Rough Cost Drivers

| Component | Idle behavior |
| --- | --- |
| Cloudflare Workers frontend | Very low for light public-demo traffic |
| API Gateway | Request based |
| Lambda | Request based |
| RDS PostgreSQL | Main idle cost; can be stopped outside demo sessions |
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
