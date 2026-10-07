# ADR 0004: Gate GitHub Writes Behind Human Approval

## Status

Accepted

## Context

The system can generate PR comments and suggested remediation patches. These actions are externally visible and can influence production infrastructure changes. Automatically posting AI-generated content or committing generated patches would create safety, trust, and auditability risks.

## Decision

Require human approval of the exact persisted review before posting GitHub PR comments. Bind the decision to a hash of draft, findings, artifacts, policy inputs, and reviewed PR head; reject incomplete runs or changed versions. Verify the live PR head before approval/posting. Generated snippets and legacy patch drafts are export-only, not directly committable. A future source-verified patch requires separate content-bound approval and non-force branch updates. Missing credentials permit an explicit mock comment; stale heads and unsupported patches fail closed rather than simulating success.

## Consequences

- Reviewers stay in control of external actions.
- The app can be demoed without live GitHub credentials.
- Audit logs can record who approved and what action was attempted.
- The workflow is safer but not fully autonomous.
- Suggested patches remain drafts that operators should review before commit.
