# ADR 0005: Use Local-First Adapters With Production Integration Seams

## Status

Accepted

## Context

The project needs to be easy to run locally for portfolio review while still showing credible production direction. External services such as OpenAI, GitHub, Cognito, Infracost, object storage, and hardened Terraform execution may not be available to every reviewer.

## Decision

Build local-first defaults and clean adapters:

- SQLite fallback for manual local development and PostgreSQL in Docker Compose.
- Local filesystem artifact storage with a path to future object storage.
- Mock GitHub responses when credentials are missing.
- Deterministic reviewer fallback when `OPENAI_API_KEY` is unset.
- Heuristic cost estimation when Infracost is unavailable.
- Dev auth fallback plus Cognito JWT validation path.
- Database-polling worker as a stepping stone toward a durable queue.

## Consequences

- The project is runnable without paid or private credentials.
- Production integration points are explicit and documented.
- Demo reliability is high because missing credentials do not break the main flow.
- Some components are intentionally not fully production hardened yet.
- Future work should replace local adapters with object storage, durable queues, stronger sandbox isolation, and org-scoped authorization.
