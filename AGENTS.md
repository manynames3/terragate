# TerraGate agent entrypoint

This is a navigation map, not a substitute for source code or tests.

## Product and architecture

- Purpose: evidence-backed Terraform PR risk analysis, not autonomous infrastructure application.
- System architecture and boundaries: docs/architecture.md, docs/architecture-notes.md, docs/enterprise-workspace.md.
- Security/threat model: docs/security.md and docs/threat-model.md.
- Operations and actual deployment state: docs/deployment.md and docs/runbook.md.
- Harness and evaluation instructions: docs/agent-harness.md and docs/agent-harness-evidence.md.

## Source of truth

- API: apps/api/app. LangGraph graph: apps/api/app/graph/terraform_review/graph.py.
- Deterministic controls: apps/api/app/graph/terraform_review/nodes/policy_checks.py.
- Terraform validation, sensitive input handling: apps/api/app/services/terraform_plan.py.
- Risk score: apps/api/app/services/risk.py.
- UI: apps/web. Infrastructure: infra. Examples: sample-data/terraform-plans.
- Existing CI is in .github/workflows/ci.yml.

## Non-negotiable invariants

1. Keep deterministic policy findings and Terraform evidence authoritative. LLM text is not proof.
2. Redact sensitive plan data before model calls, display, or upload. Unknown controls must not become an assumed pass.
3. Never auto-apply Terraform or silently push remediation to another repository.
4. Do not weaken human approval or version binding to make tests pass.
5. No fabricated metrics, successful deploy claims, GitHub results, or screenshots.
6. Keep changes within the stated task. Never edit tests merely to silence a failure.
7. External side effects (cloud deployment, production database migration, PR posting) need deliberate operator authorization.

## Verification

- Backend dependencies: python -m pip install -r apps/api/requirements.txt
- Backend tests (from apps/api): python -m pytest -q
- Agent harness self-tests: python -m unittest discover -s tools/agent_harness -p 'test_*.py' -v
- No-credit synthetic harness test: python tools/agent_harness/run.py run --agent fixture --case all
- Real subscription CLI harness: see docs/agent-harness.md. These runs work in detached temporary git worktrees.
- Frontend/infra checks: .github/workflows/ci.yml is authoritative.

When a product requirement changes, update the relevant documentation and add a regression test.
