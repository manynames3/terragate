# ADR 0006: Add Guarded Public Demo Mode

## Status

Accepted

## Context

The project should be easy for recruiters and technical reviewers to try without cloning the repo or uploading sensitive Terraform plan files. A public demo also cannot allow anonymous visitors to run arbitrary Terraform, edit policy files, or post real comments/commits to GitHub.

## Decision

Add `PUBLIC_DEMO_MODE` with explicit guardrails:

- Bundled sample-review endpoints for preloaded Terraform plans.
- Upload size limits for optional plan uploads.
- Sandbox Terraform execution disabled by default.
- Policy packs read-only.
- GitHub checks, comments, and patch commits mocked by default after approval.
- Live GitHub reads disabled by default.

Use Cloudflare Pages for the frontend and API Gateway + Lambda/Mangum for the cheapest hosted API path.

## Consequences

- Visitors can experience the product quickly without providing credentials or artifacts.
- The demo preserves the real parser, policy, LangGraph, persistence, approval, and report workflow.
- External writes remain safe for a public deployment.
- The public demo is intentionally less capable than a private production install.
- Production SaaS readiness still requires durable queues, object storage, tenant isolation, and real org/user authorization.
