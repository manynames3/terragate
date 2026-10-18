# ADR 0009: One grounded review call and source-bound evaluation evidence

Status: accepted for local implementation; live quality unevaluated.

TerraGate already had deterministic checks, sequential LangGraph enrichment, persistence and human approval. Its optional LLM calls rewrote finding text without documentation retrieval, output-reference checks or a reproducible behavioral evaluation.

Keep that application path. Replace four category-level enrichment calls in the candidate with one structured call after local resource/control-scoped retrieval. Keep rules visible as rules and preserve all authoritative findings. Validate resource addresses, attributes, references and uncertainty before accepting a model batch. Store grounding in the existing finding/report flow.

Use eleven versioned AWS/project summaries instead of a vector database, paid embeddings, runtime browsing or additional agents. This is a bounded hybrid workflow, not an autonomous general-purpose platform.

Preserve original source as a checksummed baseline archive. Keep authored labels separate from model-visible inputs. Require current source/configuration/corpus/evaluator digests, complete coverage, absolute floors, critical detection, baseline-relative counts and inspectable human semantics before a quality pass. Offline mechanics and historical replay are explicitly different from live inference.

This design adds no production dependency or idle infrastructure. It limits context and output, sometimes defers larger plans, and requires corpus maintenance. The 60 synthetic cases are not independent certification. Live evaluation and semantic assessment remain required before claiming model quality or improvement.

No MCP/AgentCore integration, deployment or branch-protection change is included. Raw graph tracing is disabled because graph state includes the original plan.
