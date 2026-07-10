# Architecture Notes

## Scope and status

The AWS-icon diagram describes the Terraform-defined public-demo deployment. The optional Mermaid diagram provides a simpler logical view. The repository has two implemented operating shapes:

- **Terraform-defined public demo:** a Cloudflare/OpenNext frontend calls an AWS API Gateway and Lambda backend backed by private RDS PostgreSQL.
- **Local development:** Docker Compose runs the Next.js web app, FastAPI API, database-polling worker, and PostgreSQL. Manual API runs may use SQLite.

The repository proves configuration and implementation, not the current state of a deployed cloud account. "Public demo" below therefore means the resources defined in `infra/terraform/aws-public-demo`, while "optional" means an adapter exists but is disabled, unavailable, or credential-dependent in that stack. Planned components are explicitly labeled.

## Component inventory

| Area | Implemented component | Evidence and qualification |
| --- | --- | --- |
| Frontend | Next.js 16, React 19, OpenNext on Cloudflare Workers | `apps/web/package.json`, `open-next.config.ts`, and `wrangler.jsonc`; Workers observability is enabled. Frontend deployment is a package script, not a GitHub Actions job. Cloudflare is intentionally shown with a non-AWS icon. |
| Public API | API Gateway v2 HTTP API | Terraform defines a public `$default` route with CORS and an AWS proxy integration. |
| API/backend | FastAPI on a Lambda container through Mangum | `infra/Dockerfile.lambda`, `app/lambda_handler.py`, and Terraform. The public demo uses `REVIEW_EXECUTION_MODE=inline`; it has no separate worker. |
| Review engine | LangGraph workflow with deterministic policy checks before optional LLM enrichment | `apps/api/app/graph/terraform_review`. Raw plans are redacted before reviewer enrichment. |
| Database | Encrypted, private RDS PostgreSQL (gp3) | Terraform places RDS in two private subnets and allows port 5432 only from the Lambda security group. Docker Compose uses PostgreSQL; manual local mode can fall back to SQLite. |
| Artifact storage | Lambda `/tmp/artifacts` in the public demo; local filesystem adapter elsewhere | `ARTIFACT_STORAGE_DIR` and `app/integrations/storage.py`. This storage is ephemeral in Lambda. S3 is planned, not implemented. |
| Build registry | CodeBuild and ECR | Terraform starts CodeBuild during apply; CodeBuild clones a selected Git ref, builds `Dockerfile.lambda`, and pushes to scan-on-push ECR. |
| CI | GitHub Actions | `.github/workflows/ci.yml` runs backend pytest and frontend test, typecheck, lint, and build. It performs no deployment. |
| Observability | CloudWatch Logs, Cloudflare Workers observability, database audit events | Terraform creates 14-day Lambda and CodeBuild log groups. `wrangler.jsonc` enables Workers observability. Audit events are persisted by `app/services/audit.py`. LangSmith is optional and disabled in the public-demo Terraform. |

## Request and review flow

1. A reviewer loads the OpenNext-rendered frontend from Cloudflare Workers. Browser-side API calls go directly to the configured API Gateway base URL.
2. API Gateway invokes the Mangum-wrapped FastAPI Lambda. A review comes from a bundled sample, a size-capped plan upload, or an optional GitHub webhook.
3. The backend stores artifacts under Lambda `/tmp`, validates and redacts the plan, runs deterministic checks, and executes the LangGraph review inline.
4. Runs, findings, evidence, approvals, jobs, and audit events are persisted to RDS PostgreSQL.
5. Optional OpenAI, LangSmith, Infracost, and GitHub adapters enrich or publish results only when configured. The Terraform-defined public demo has no NAT gateway and disables live GitHub reads, GitHub writes, LangSmith tracing, and sandbox execution; GitHub writes are mocked.
6. A human approval is required before the application can post a GitHub comment or commit a suggested patch. The approval is an application control, not an AWS IAM boundary.

## Deployment and CI flow

- **Backend deployment:** an operator runs Terraform. Terraform provisions the AWS resources and invokes CodeBuild through a `local-exec` provisioner. CodeBuild clones the configured public Git ref, builds the Lambda image, pushes it to ECR, and Lambda is pinned to the resulting image digest.
- **Frontend deployment:** an operator runs `npm run deploy:cloudflare` in `apps/web`; OpenNext builds the Worker and Wrangler deploys it. This step is manual in the repository.
- **CI:** pushes to `main` and pull requests trigger GitHub Actions tests and builds. CI does not apply Terraform or deploy either application.

## Security boundaries

- API Gateway and Cloudflare Workers are public ingress points. API Gateway restricts browser origins through configured CORS; CORS is not authentication.
- Lambda and RDS are in private subnets. RDS is not publicly accessible, storage encryption is enabled, and its security group accepts PostgreSQL only from the Lambda security group.
- There is no NAT gateway. That lowers cost and prevents Lambda from reaching public integrations in the default public-demo network shape.
- The public-demo Terraform explicitly uses `AUTH_MODE=dev`. Cognito JWT/PKCE support exists in application code, but Cognito resources are not provisioned by this stack and should not be represented as active demo authentication.
- Secret-like plan values and GitHub patches are redacted before optional AI processing. Raw artifacts still require sensitive-data handling.
- The generated database password is present in Terraform state and the Lambda environment. `extra_environment` can also expose supplied values through state; a production design should use a managed secret path.

## Cost controls

- API Gateway and Lambda are request-driven, and the demo executes reviews inline instead of paying for an always-on worker.
- No NAT gateway is created.
- RDS defaults to `db.t4g.micro`, 20 GiB gp3, zero-day backup retention, no deletion protection, and no final snapshot. These settings favor a disposable demo over production durability.
- CloudWatch log retention is fixed at 14 days, and ECR is configured for force deletion.
- Stopping RDS outside demo sessions is documented as a **manual** cost control; Terraform does not schedule it.
- Heuristic cost estimation remains available when Infracost is not installed or configured.

## Optional and planned paths

- **Optional, implemented in code:** Cognito authentication, GitHub reads/webhooks/writes, OpenAI enrichment, LangSmith tracing, Infracost estimation, local/background/worker execution, Terraform sandboxing, Redis, and Qdrant. Redis and Qdrant are Compose profiles and are not wired into the AWS public-demo stack.
- **Planned:** S3-backed artifact storage, a durable queue, stronger isolated workers, short-lived cloud credentials, policy-pack versioning, and OPA/Rego execution alongside the current Python checks.

## Render the AWS-icon diagram

The Python package is isolated from the API runtime in `docs/requirements.txt`. Diagrams uses the Graphviz `dot` executable, so install Graphviz first if it is not already available:

```bash
# macOS
brew install graphviz

# Debian/Ubuntu
sudo apt-get install graphviz
```

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r docs/requirements.txt
python docs/architecture_aws.py
```

The render command writes both `docs/architecture_aws.png` and `docs/architecture_aws.svg`. The PNG is the primary README visual; the SVG is retained for high-resolution use. The optional logical diagram remains in `docs/architecture.mmd` with its previously rendered `docs/architecture.svg`.
