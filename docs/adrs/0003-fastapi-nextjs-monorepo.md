# ADR 0003: Keep The Product As A FastAPI And Next.js Monorepo

## Status

Accepted

## Context

The project needs a polished dashboard, a typed API, Terraform artifact handling, Python-based AI workflow libraries, database persistence, and local demo ergonomics. Splitting frontend and backend into separate repositories would add coordination overhead without improving the portfolio demo.

## Decision

Use a monorepo with `apps/web` for the Next.js TypeScript dashboard and `apps/api` for the FastAPI Python backend. Keep shared contracts explicit through Pydantic schemas and TypeScript API types rather than a separate package.

## Consequences

- The full product can be reviewed and run from one repository.
- Python remains available for LangGraph, LangChain, SQLAlchemy, Alembic, and infrastructure parsing.
- Next.js supports a polished dashboard without mixing UI concerns into the API.
- Docker Compose can run the whole stack locally.
- API and frontend types must be kept in sync manually for now.
