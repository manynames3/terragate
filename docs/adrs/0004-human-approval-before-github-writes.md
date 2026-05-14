# ADR 0004: Gate GitHub Writes Behind Human Approval

## Status

Accepted

## Context

The system can generate PR comments and suggested remediation patches. These actions are externally visible and can influence production infrastructure changes. Automatically posting AI-generated content or committing generated patches would create safety, trust, and auditability risks.

## Decision

Require human approval before posting GitHub PR comments. Require separate approval before committing suggested patch drafts. If credentials are missing, the PR is from a fork, or required metadata is unavailable, return a mock response instead of mutating GitHub.

## Consequences

- Reviewers stay in control of external actions.
- The app can be demoed without live GitHub credentials.
- Audit logs can record who approved and what action was attempted.
- The workflow is safer but not fully autonomous.
- Suggested patches remain drafts that operators should review before commit.
