# Durable Worker Queue Plan

## TL;DR

The current worker persists jobs in PostgreSQL and claims queued jobs through database polling. It is useful for local demos and low-volume pilots, but a paid production deployment should use a durable queue such as SQS, Step Functions, Celery, or Temporal.

## Current State

- `ReviewJobModel` stores queued review payloads.
- `apps/api/app/worker.py` claims queued jobs and executes the review workflow.
- `REVIEW_EXECUTION_MODE` supports inline, background, and worker-oriented execution.
- Graph progress is persisted so the UI can show node-level progress.

## Production Queue Requirements

- Durable message delivery.
- Visibility timeouts and leases.
- Dead-letter queue or failed workflow table.
- Retry policy per graph node or workflow stage.
- Idempotency key per run/job.
- Customer-visible failure reason.
- Metrics for queue depth, age, retry count, and DLQ count.

## AWS Direction

For the AWS-centered deployment, SQS is the simplest next step:

1. API writes run/job records and sends an SQS message with `run_id`.
2. Lambda or ECS worker consumes the message.
3. Worker loads payload from the database, not from the message body.
4. Worker updates graph progress and final status.
5. Failed messages go to DLQ after the retry budget.

Temporal or Step Functions would make more sense if long-running workflows, human waits, or multi-service orchestration become central to the product.
