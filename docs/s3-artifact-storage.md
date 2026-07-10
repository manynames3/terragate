# S3/KMS Artifact Storage Plan

## TL;DR

The current storage adapter is local filesystem based, and the public-demo Lambda uses `/tmp/artifacts`. Production should move artifacts to S3 with SSE-KMS, retention policies, object tags, and explicit deletion controls.

## Current State

- `apps/api/app/integrations/storage.py` writes artifacts to a configured local directory.
- Local/Docker development stores artifacts on disk.
- AWS public-demo mode stores artifacts in Lambda `/tmp`, which is ephemeral.

## Production Design

- Bucket per environment or per tenant boundary.
- SSE-KMS with a customer/environment-specific KMS key.
- Object tags for `run_id`, `org_id`, `artifact_type`, `redacted`, `retention_class`, and `policy_version`.
- Lifecycle rules for automatic expiration.
- Explicit delete endpoint for customer-controlled cleanup.
- Presigned read URLs only for short-lived internal/admin access if needed.
- No raw artifacts sent to LLM providers.

## Why It Is Not Implemented Yet

Adding S3 properly would require AWS SDK dependencies, IAM policies, KMS key management, retention semantics, and migration of local public-demo behavior. That is the right production next step, but not required for a low-cost public demo.
