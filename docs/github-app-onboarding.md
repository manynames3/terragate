# GitHub App Onboarding Plan

## TL;DR

The code supports GitHub PR metadata, webhooks, automatic checks, and versioned approval-gated comments. Generated remediation snippets are export-only; a source-verified patch generation flow is not available. The missing product layer is a guided installation and repository registration flow.

## Current Capabilities

- Fetch PR metadata and changed Terraform files.
- Redact PR patch context.
- Map findings back to likely changed files.
- Receive GitHub webhook events.
- Require a configured HMAC secret and valid signature; otherwise webhook processing is disabled. Idempotent delivery handling is not implemented.
- Create check-run style status records.
- Post approved PR comments or return a clear mock response.
- Validate complete source-context diffs in the patch adapter. Generated snippets are export-only, not executable commits.

## Minimal Turnkey Flow

1. Admin clicks "Connect GitHub App".
2. GitHub App installation redirects back with installation ID.
3. TerraGate stores installation-to-organization mapping.
4. Admin selects repositories and default policy profile.
5. TerraGate verifies webhook secret and check permissions.
6. A test PR event runs a review and posts a check status.

## Permissions

Recommended GitHub App permissions:

- Metadata: read
- Pull requests: read
- Checks: write
- Contents: write, only if approved patch commits are enabled

Patch commits should remain separately approval-gated.

## Public Demo Behavior

The public demo should not allow anonymous visitors to install or write through a real GitHub App. It should show the workflow and mock external writes unless configured for a private demo environment.

The workspace's Repositories page lists **observed context**, not installations. No organization-owned installation/registration or trusted-CI artifact ingestion is implemented by the [local workspace update](enterprise-workspace.md). Do not present credentials being configured as verified webhook/check/merge health.
