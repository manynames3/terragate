# TerraGate v2 architecture and operation

V2 extends the existing FastAPI → persisted review job → sequential LangGraph → saved findings/report → human approval path. Existing upload endpoints, findings fields, review history, policy packs and GitHub approval boundaries remain. API additions are optional grounding metadata and a `grounded_assessment` in the report response. Alembic `0010_finding_grounding` adds a nullable JSON column, preserving historical findings.

## Actual reviewer flow

1. Validate the JSON shape, actions, unique addresses, masks, size, resource count and nesting. Store raw artifacts through the existing private filesystem adapter.
2. Redact secret-like keys and Terraform sensitivity masks; normalize resource changes, preserving unknown values.
3. Run existing security, cost, recovery and governance rules. V2 adds trust, S3 ACL/policy and standalone ingress checks; fixes Deny wildcard false alarms, ambiguous policies, no-op recovery checks and misleading RDS/S3 advice.
4. The existing category nodes retain deterministic findings. In v2 they make no model calls.
5. `grounded_review` retrieves local, resource/control-scoped evidence **before** inference. Model input contains addresses, actions, relevant before/after facts, unknown/sensitive markers, deterministic findings and the selected evidence summaries. It excludes arbitrary descriptions, tags, outputs and IAM statement IDs; encoded policy values receive additional redaction.
6. Make at most one structured provider call using the existing LangChain OpenAI adapter. It may explain a rule or add an interpretation about an actual changed attribute. It cannot erase a rule, lower its severity, cite an absent document, redirect a URL or attach an explanation to an unrelated resource/attribute. A new model finding is explicitly labeled `llm_reviewer`; enriched rules keep `deterministic_rule` with `interpretation_source=model`.
7. Validate the whole output batch before accepting any part. URLs come from the corpus. Unknown/sensitive interpretations stay uncertain and require a human. Structural validation does **not** prove semantic support; that is separately scored and manually inspected.
8. Rank, map PR context, produce restrained remediation examples, build escaped reports, persist grounding and sanitized usage, and stop for existing approval. Grounding participates in the approval snapshot.

The assessment uses `safe`, `risky` or `needs_context`. Failed model calls retain rule findings and show their unavailable status; they do not become model-verified safe results. `safe` means no material risk established in the reviewed scope, not a security guarantee. The legacy numeric confidence field is retained for API compatibility, labeled as a heuristic, and no longer displayed as a probability.

## Limits and failure behavior

| Boundary | Default v2 limit |
| --- | --- |
| Plan | 1,500,000 bytes, 100 resources, 64 JSON nesting levels; reject rather than silently drop resources |
| Configurable maxima | 5 MB, 200 resources; trusted application settings only |
| Corpus | 128 KB, 30 entries, 2,000 characters/passage; shipped corpus has 11 entries |
| Retrieval | One local retrieval stage, at most 8 documents/resource; no runtime web search or embeddings |
| Freshness | Quarantine inactive/conflicting, future-dated or older-than-180-day summaries; flag missing/truncated evidence |
| Model context | 12,000-token conservative upper bound including schema/message allowance; skip with `context_limit`, never silently truncate |
| Model output | 4,096 completion tokens including reasoning, at most 20 interpretations |
| Provider | One attempt, zero SDK retries, 30-second HTTP timeout; 2 concurrent calls **per application process**, no waiting queue |
| Graph | 180-second deadline checked between steps; per-step timeout at least 35 seconds; non-model nodes retain at most 3 attempts; recursion limit 32 |
| Optional Infracost | Existing subprocess capped at 20 seconds; not used during evaluation |
| Evaluator | One case at a time; hard child-process timeout 45 seconds candidate / 135 seconds baseline; 900-second run budget by default, at most 60 cases |

HTTP operation/graph-step timeouts do not provide instantaneous thread cancellation. The evaluator's subprocess boundary supplies a hard wall-clock stop; a terminated in-flight provider request may still be billed. The process-local semaphore is not an account-wide spend controller. Existing hosting/process counts must be accounted for. No new service, warm-up schedule or infrastructure deployment was added.

With no evidence the model is not called. When only some resource scopes lack evidence, the available evidence remains usable and the report explicitly calls for verification elsewhere. Suspicious instruction-like passages are quarantined, and all evidence is still treated as data by the system prompt. The lexical quarantine is defense in depth, not a proof of injection resistance. Curators must mark contradictory guidance inactive/conflicting; there is no automated semantic contradiction detector.

## Local use

From the repository root:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
make eval-validate
make test
cd apps/api
alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

Run the existing frontend separately with `npm ci && npm run dev` in `apps/web`. Existing Dockerfiles already copy the corpus because it lives under `app/policies`; no image/hosting change is required.

`REVIEWER_VERSION=grounded-v2` is the default. `legacy-v1` retains the legacy enrichment option for application compatibility; reproducible comparison uses the immutable original source snapshot instead. `OPENAI_API_KEY` enables the candidate. Without it, the application still reviews using deterministic checks and labels model review disabled. The evaluator separately requires an exported key and explicit live/budget flags; a local `.env` is not live-run authorization.

Review limits are configured with `REVIEW_MAX_PLAN_BYTES`, `REVIEW_MAX_RESOURCES`, `REVIEW_MAX_INPUT_TOKENS`, `REVIEW_MAX_OUTPUT_TOKENS`, `REVIEW_MODEL_TIMEOUT_SECONDS`, and `REVIEW_MAX_SECONDS`. Benchmark inference pins its model/settings independently of the app's configurable model alias.

## Data handling and observability

Raw uploads remain sensitive, privately stored artifacts under the existing adapter; Lambda storage remains ephemeral. Redaction uses masks, key detection and reduced inputs and cannot discover every unmarked secret or private identifier. Do not upload real client plans as public examples. Provider error text and raw responses are excluded from evaluation artifacts. Model prose and plan values are escaped in Markdown and rendered as text in React. No plan content is executed or used as shell code.

Raw LangGraph state contains the original plan, so graph tracing is explicitly disabled even if a LangSmith environment toggle is set. No synthetic LangSmith trace ID is advertised. Node progress, model status, elapsed time, returned usage and grounding remain persisted locally. Adding sanitized remote instrumentation is separate work.

## Tradeoffs and excluded extensions

- Local scoped lookup is sufficient for eleven curated documents. It is inspectable, cheap at idle and easy to version. It cannot answer arbitrary AWS questions or establish live account controls.
- Deterministic checks remain a visible safety floor. GenAI adds grounded interpretation and context-aware recommendations; this is a hybrid reviewer, not an autonomous infrastructure agent.
- The frozen v1 graph provides a reproducible original baseline. The evaluator adds disclosed safety/telemetry bounds around its provider calls; changed rules, prompts, retrieval and validation mean any difference cannot be attributed solely to RAG.
- No MCP server was added: no concrete MCP client workflow was supplied, and an additional server/dependency would not strengthen the core evidence. A future thin adapter should call the existing lookup/review functions, with a real client round trip.
- AgentCore Evaluations was excluded. A trace-instrumentation/evaluator/region/IAM/billing integration would add disproportionate scope before live model quality is established. No AgentCore API was implemented or claimed to grade raw plans. Current AWS integration requirements and pricing remain unverified.

See [evaluation commands and methodology](evaluations.md), [project state](../STATE.md), and the [four-minute demo](demo-v2.md). Nothing here establishes deployment, branch protection, production readiness or improved model accuracy.

The curated model context currently focuses on selected AWS security and recovery controls. Existing cost, tag and other governance checks continue deterministically; the corpus is not a pricing feed or complete compliance reference. A completed model call can leave some findings with rule-only explanations, which the assessment counts and warns about.
