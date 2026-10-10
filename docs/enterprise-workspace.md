# Enterprise Review Workspace

## Scope And Verification

The first vertical slice improves review correctness, evidence inspection, scoped decisions, and the work queue; it is not a claim of customer-ready SaaS. See the [deployment record](deployment.md#verified-public-demo-release) for verified release status. No new direct production dependencies were added. Existing Next.js/ESLint packages are pinned to patched 16.3.8 and OpenNext to 1.20.10 after a runtime incompatibility with 16.4.0; affected locked packages were refreshed and Worker rendering is now checked in CI.

| Capability | Implemented here | Remaining boundary |
| --- | --- | --- |
| Review workspace | Organization-scoped search, filters, stable pagination, keyboard/clickable rows, truthful missing/error states | Repository records are observed review context, not verified installations |
| Review detail | Overview, Findings, Plan, Runbook, Compliance, History; shareable URL/hash | No verified merge-enforcement signal; mappings are not certification |
| Evidence | Saved redacted before/after values, unknown mask, integrity-checked artifact, rule ID/source hash | Local files can expire; historical findings have no rule hash |
| Policy provenance | Immutable evaluated inputs per review; SHA-256 content identifier | Global JSON policy files, not organization-owned approved revisions |
| Exceptions | Finding + exact snapshot scope, justification, expiry, different-admin decision, revocation, audit | Do not authorize deployment, reduce raw risk, or synchronize GitHub checks |
| Private auth | Cognito issuer/signature/expiry/client validation + active persisted subject/org/role membership | Operator provisioning, no invitations or organization management UI; no PostgreSQL RLS |
| Storage | Scoped redacted-plan API, root checks, SHA-256 integrity, private file/directory permissions, fixed raw filename | No S3/KMS, customer retention, deletion, or persistent Lambda artifacts |
| Operations | Request IDs, sanitized JSON failure logs, liveness/database readiness; artifact preflight failures persist failed state and check transport failures preserve assessment | No new alarms, service SLOs, worker lease recovery, or exactly-once GitHub writes |
| GitHub | Existing credential-dependent adapters; webhook HMAC required, otherwise disabled | Installation ownership, repository registration, trusted CI artifact ingestion, delivery dedupe and revision reconciliation remain incomplete |

The core GitHub installation-to-CI-plan-to-revision lifecycle is **not complete**. The Repositories and Integrations screens say this explicitly rather than presenting a nonworking connect button.

## Implementation Map

| Area | Primary files |
| --- | --- |
| Review queue, scoped evidence, exceptions and audit API | [workspace routes](../apps/api/app/routes/workspace.py), [decision service](../apps/api/app/services/review_workspace.py) |
| Private identity and membership administration | [auth enforcement](../apps/api/app/auth/dev.py), [operator CLI](../apps/api/app/auth/memberships.py) |
| Persistence and schema upgrade | [models](../apps/api/app/models/entities.py), [migration 0009](../apps/api/alembic/versions/0009_review_workspace.py) |
| Sensitive/unknown Terraform inputs and artifact boundaries | [plan handling](../apps/api/app/services/terraform_plan.py), [policy checks](../apps/api/app/graph/terraform_review/nodes/policy_checks.py), [storage](../apps/api/app/integrations/storage.py) |
| Light workspace and contextual review UX | [shell](../apps/web/components/app-shell.tsx), [queue](../apps/web/components/review-workspace.tsx), [detail](../apps/web/components/run-detail.tsx), [exceptions](../apps/web/components/exceptions.tsx), [plan evidence](../apps/web/components/plan-evidence.tsx), [theme](../apps/web/styles/globals.css) |
| Regression and runtime evidence | [workspace API tests](../apps/api/app/tests/test_workspace.py), [integrity tests](../apps/api/app/tests/test_review_integrity.py), [browser smoke](../apps/web/e2e/review-workspace.cjs), [validation record](testing.md#workspace-validation-record) |

## Decisions Are Different

- **Risk** is the saved API assessment. An unfinished review has a null score and `not_assessed`; failed review has `unavailable`. A completed safe plan can legitimately score zero.
- **Policy decision** is `blocked` while critical/high findings, verification-required/low-confidence findings, or findings without evidence lack a current approved exception. Otherwise it is `accepted_risk` when a finding has current approved acceptance, or `passed`. This is a local review decision, not authorization to merge/apply and not a new policy-pack threshold setting.
- **Comment approval** authorizes only the exact saved comment and review snapshot. It does not accept the infrastructure risk.
- **Exception** accepts one finding in one immutable review snapshot for up to 90 days. A different platform administrator must approve/deny; approved acceptance can be revoked. Expiry and changed review content invalidate it automatically when read or evaluated. Evidence stays visible. A new run does not inherit acceptance.
- Existing exception status, scope, expiration and attribution are visible from the finding pane. Exception links include the exact finding in the shareable review URL.
- **GitHub check** is an external integration result. No URL means "not published," not a fake pass. Exception approval does not silently update that check.

The attention queue includes unfinished/comment-pending reviews and high-risk or uncertain findings, even after comment approval or risk acceptance. It is deliberately not a merge-eligibility filter.

## Finding And Plan Integrity

New deterministic findings capture a hash of the policy engine, cost/blast-radius implementations, and Terraform normalization/redaction code. Policy versions hash the saved evaluated policy JSON, not its display name. Both provenance fields are distinct from the reviewed commit SHA.

Plans redact secret-like keys, Terraform `before_sensitive`/`after_sensitive` masks, sensitive planned values, and sensitive outputs. Known after-state does not fall back to old before-state. Unknown or redacted policy inputs produce explicit verification-required evidence with low confidence instead of a confirmed failure or pass. Partial nested inputs are conservatively treated as uncertain; full before-versus-after risk classification remains future work.

The plan endpoint serves only a scoped, saved **redacted** artifact. It verifies the configured root and SHA-256 digest; expired files return 410 and modified files return 409. There is no raw-artifact download endpoint. Do not interpret redaction as a guarantee that all secrets embedded in arbitrary free-form strings are detected.

## Migration And Private Auth Setup

Back up the database before migration. Run from `apps/api` with the deployment's database configuration:

```bash
alembic upgrade head
```

`0009_review_workspace` adds memberships, exceptions, and finding rule versions, and widens user IDs to hold Cognito subjects. Existing review content is preserved; historical rule versions remain null. Downgrade removes these new tables/column but intentionally keeps widened identity columns to avoid truncation. It deletes exception/membership records: export them before rollback. SQLite and isolated PostgreSQL upgrade/downgrade preservation are tested, including a locally restored hosted-database backup. This does not validate concurrent migration execution or worker locking.

For private deployments:

1. Set `AUTH_MODE=cognito`, issuer/pool configuration and **required** `COGNITO_APP_CLIENT_ID`; disable `PUBLIC_DEMO_MODE`.
2. Use a public Cognito app client with PKCE. Configure the signed organization attribute (`COGNITO_ORG_CLAIM`, default `custom:org_id`) through trusted administration. Do not make organization or role attributes user-writable.
3. Configure the existing `NEXT_PUBLIC_COGNITO_*` frontend settings. The browser sends the ID token when available because normal Cognito access tokens do not include custom user attributes; the backend validates its audience. Access tokens are also supported if they carry the configured org claim and match the client.
4. An operator with database access provisions explicit membership, using the verified Cognito **sub**, not email:

```bash
python -m app.auth.memberships grant \
  --subject '<cognito-sub>' --organization '<org-claim>' \
  --role reviewer --actor '<operator-identity>'
python -m app.auth.memberships revoke \
  --subject '<cognito-sub>' --organization '<org-claim>' \
  --role reviewer --actor '<operator-identity>'
```

There is no self-service role grant. Active database membership overrides token groups/role claims; missing or wrong-org membership fails with 403. Operator changes write attributed audit records; attribution is operator supplied, not a second IdP authentication. These run-independent events are not shown in the run-scoped Audit Log page. Private `APP_ENV=production`/`prod` rejects dev-header auth. The public demo remains deliberately shared and must not receive customer secrets.

## Locally Verified Workflow

The checked-in [browser smoke test](../apps/web/e2e/review-workspace.cjs) uses real local API reviews of repository fixtures, not fabricated UI results. It tests queue keyboard navigation, saved evidence, exact snippet download, separate-requester/admin exception approval, unchanged raw score, comment approval/mock posting, disabled repeat posting, audit history, error/stale/empty states, navigation, and desktop/tablet/mobile layout.

Browser testing deliberately refuses non-loopback hosts and an API without public-demo mode. External GitHub writes, live Cognito login, AWS execution, Infracost API pricing, PostgreSQL concurrency, and worker crashes are not validated by that test. See [testing](testing.md) for commands.

## Next Slice

1. Address remaining tooling advisories and validate private Cognito membership onboarding and concurrent database behavior before accepting customer data; the production npm audit is clear, but the complete tooling audit is not.
2. Build organization-owned GitHub installation/repository registration and trusted-CI plan ingestion, bound to delivery ID, repository, PR and commit SHA. Add webhook replay and revision tests.
3. Add worker leases/recovery and persistent encrypted artifacts with retention/deletion before claiming durability.
4. Reconcile exception decisions with GitHub checks and verify branch-protection requirements before claiming a merge gate.

Do not enable untrusted Terraform execution to bypass missing CI ingestion. Release only after explicit authorization and verified CI.
