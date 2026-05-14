# ADR 0002: Use LangGraph For The Terraform Review Workflow

## Status

Accepted

## Context

The Terraform review process has multiple ordered steps: ingest, validate, redact, normalize, check policies, estimate cost, analyze blast radius, enrich findings, deduplicate, map PR context, generate remediations, map compliance, build a report, and stop for approval. These steps need explicit state, progress visibility, and retry behavior.

## Decision

Use LangGraph to model the review as a named-node workflow with a shared `TerraformReviewState`. The API and worker execute the same graph, and node progress is persisted to the run record.

## Consequences

- The workflow is visible in the UI as named progress steps.
- Review state is typed and carried through the graph.
- The worker and inline execution paths share the same orchestration code.
- Node retries can be configured through settings.
- The current graph is linear; more complex branching can be added later if needed.
