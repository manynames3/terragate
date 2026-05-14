# ADR 0001: Use Deterministic Policy Checks Before AI Reviewer Nodes

## Status

Accepted

## Context

Terraform plans can expose production-impacting changes such as public ingress, RDS deletion, IAM wildcards, missing encryption, and high-cost resources. A review system that sends a raw plan to an LLM and asks for advice would be hard to trust, difficult to test, and vulnerable to hallucinated findings.

## Decision

The backend parses Terraform plan JSON, redacts sensitive values, extracts normalized resource changes, and runs deterministic policy checks before any AI reviewer node. AI reviewer nodes can explain, prioritize, group, and suggest remediation from structured evidence, but deterministic rules create the core findings.

## Consequences

- Findings have concrete evidence, rule IDs, and JSON paths.
- The app works locally without an LLM provider.
- Tests can cover parser, redaction, policy checks, and risk scoring directly.
- LLM output is constrained to enrichment rather than source-of-truth detection.
- More policy coverage requires maintaining explicit rules and policy packs.
