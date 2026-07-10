# ADR 0008: Defer S3 Artifact Storage And Durable Queue Until Paid Pilot

## Status

Accepted

## Context

S3/KMS artifact storage and SQS/Temporal-style durable execution are the right production direction, but adding them prematurely would increase code, infrastructure, secrets, and cost surface for a public work sample. The current goal is a credible low-cost Terraform PR review demo with honest boundaries.

## Decision

Keep the local filesystem artifact adapter and database-polling worker for the current version. Document the S3/KMS and durable-queue designs, keep integration seams small, and validate the current implementation with tests and CI.

## Consequences

- The public demo remains cheap and easier to operate.
- The repo does not pretend to be fully production SaaS-ready.
- Paid pilot readiness requires implementing object storage, retention/delete controls, and a durable queue.
- The current adapter and worker designs make those upgrades incremental rather than a rewrite.
