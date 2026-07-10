# Observability Model

## TL;DR

Observability is split between application-level review progress/audit records and infrastructure-level logs. The repo includes CloudWatch log groups, Cloudflare Workers observability, persisted graph progress, and optional LangSmith tracing.

## What Exists

| Signal | Where |
| --- | --- |
| API and Lambda logs | CloudWatch log group from Terraform, 14-day retention |
| CodeBuild logs | CloudWatch log group from Terraform, 14-day retention |
| Frontend worker telemetry | `apps/web/wrangler.jsonc` has Workers observability enabled |
| Review node progress | Persisted on run records and shown in the UI |
| Audit events | Database records written by `apps/api/app/services/audit.py` |
| Optional traces | LangSmith env vars and integration adapter |

## Operational Questions It Can Answer

- Did the review start, finish, fail, or wait for approval?
- Which graph node failed or is currently running?
- What findings and evidence were generated?
- Who approved or rejected a PR comment draft?
- Was a GitHub write attempted, mocked, or posted?
- Which artifact and policy profile were used?

## Gaps

- No CloudWatch metric alarms are currently defined in Terraform.
- No dashboard JSON is checked in.
- No distributed trace link is surfaced in the UI yet.
- No synthetic uptime check is configured.
- Worker retries are visible in persisted records, but DB polling is not a durable queue.

## Next Production Steps

1. Add CloudWatch alarms for API 5xx, Lambda errors, Lambda duration, RDS CPU/storage, and CodeBuild failures.
2. Add a lightweight `/health` synthetic check.
3. Surface LangSmith trace IDs in run detail when tracing is enabled.
4. Add structured JSON logs for run ID, org ID, node name, and GitHub action IDs.
5. Add dead-letter queue metrics once the worker moves to SQS or another durable queue.
