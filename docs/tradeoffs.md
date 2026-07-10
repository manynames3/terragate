# Tradeoffs

## TL;DR

TerraGate intentionally prioritizes a credible, low-cost Terraform PR review workflow over broad platform scope. The current tradeoffs make it strong as a public work sample and guided pilot candidate, but not yet a turnkey multi-tenant SaaS.

## Deterministic First, AI Second

**Decision:** Use parser and policy evidence as the source of truth, then let AI explain, prioritize, and draft remediation.

**Why:** Terraform review needs trust. Hallucinated findings are worse than missing a cosmetic suggestion.

**Cost:** More engineering work than a simple "upload plan to LLM" flow.

## DB-Polling Worker

**Decision:** Persist jobs in the database and let a worker claim queued jobs.

**Why:** It demonstrates async behavior and progress persistence without requiring a broker.

**Cost:** It is not as durable or scalable as SQS, Celery, Step Functions, or Temporal.

## Local Filesystem / Lambda `/tmp` Artifacts

**Decision:** Use local filesystem storage behind a small adapter.

**Why:** Simple local development and cheap public demo deployment.

**Cost:** No durable retention, customer deletion controls, cross-instance access, or KMS-backed object storage yet.

## No NAT Gateway In Public Demo

**Decision:** Keep Lambda in private subnets without NAT.

**Why:** NAT gateway idle cost would dominate the public demo.

**Cost:** Live outbound integrations are disabled or mocked unless an egress path is added.

## Dev Auth In Public Demo

**Decision:** Use dev auth for the public demo while preserving Cognito support in code.

**Why:** Anonymous visitors can try sample reviews without sign-in friction.

**Cost:** The public demo should not be represented as a production-authenticated SaaS environment.

## Focus On Terraform PR Review

**Decision:** Implement Terraform PR Review, Compliance, and Runbook modes before broad incident/cost features.

**Why:** The strongest wedge is one painful workflow with measurable risk reduction.

**Cost:** The "command center" vision remains intentionally narrower until the first workflow is strong.
