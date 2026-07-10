# ADR 0007: Use Cloudflare Workers And AWS Lambda For The Low-Cost Public Demo

## Status

Accepted

## Context

The project needs a public demo that recruiters and technical reviewers can try without cloning the repo, but the infrastructure should not create high idle cost. The product also needs to demonstrate real AWS/cloud engineering rather than only local Docker Compose.

## Decision

Serve the Next.js frontend from Cloudflare Workers through OpenNext. Serve the FastAPI backend from AWS API Gateway and a Mangum-wrapped Lambda container. Use private RDS PostgreSQL for persisted review state, run the workflow inline in public-demo mode, and keep GitHub writes, live outbound integrations, sandbox execution, and policy edits guarded or mocked by default.

## Consequences

- The demo is accessible without local setup.
- Idle cost is mostly the small RDS instance.
- The repo demonstrates Terraform-defined AWS infrastructure and Cloudflare deployment configuration.
- Avoiding NAT gateway keeps cost down but disables live outbound calls from the private Lambda network shape.
- The public demo remains intentionally below a hardened multi-tenant SaaS deployment.
