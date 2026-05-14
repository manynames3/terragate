from typing import Any

from pydantic import BaseModel, Field

from app.config import Settings


class FindingExplanation(BaseModel):
    id: str
    impact: str
    recommendation: str
    confidence: float = Field(ge=0, le=1)


class ReviewerOutput(BaseModel):
    findings: list[FindingExplanation] = Field(default_factory=list)


def summarize_with_llm(
    settings: Settings,
    reviewer_node: str,
    category: str,
    findings: list[dict[str, Any]],
    resource_summaries: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    if not settings.openai_api_key or not findings:
        return findings

    try:
        from langchain_core.prompts import ChatPromptTemplate
        from langchain_openai import ChatOpenAI
    except Exception:
        return findings

    reduced_findings = [
        {
            "id": item["id"],
            "title": item["title"],
            "severity": item["severity"],
            "resource": item.get("resource_address"),
            "evidence": item.get("evidence", [])[:2],
        }
        for item in findings
    ]

    prompt = ChatPromptTemplate.from_messages(
        [
            (
                "system",
                (
                    "You are a TerraGate Terraform reviewer. Do not invent new findings. "
                    "Only explain and prioritize the provided deterministic evidence. "
                    "Return the same finding ids with concise impact and recommendation."
                ),
            ),
            (
                "human",
                "Reviewer node: {reviewer_node}\nCategory: {category}\nFindings: {findings}\nResources: {resources}",
            ),
        ]
    )
    model = ChatOpenAI(model=settings.openai_model, temperature=0, api_key=settings.openai_api_key)
    chain = prompt | model.with_structured_output(ReviewerOutput)

    try:
        result = chain.invoke(
            {
                "reviewer_node": reviewer_node,
                "category": category,
                "findings": reduced_findings,
                "resources": resource_summaries[:20],
            }
        )
    except Exception:
        return findings

    by_id = {finding["id"]: finding for finding in findings}
    for explanation in result.findings:
        target = by_id.get(explanation.id)
        if not target:
            continue
        target["impact"] = explanation.impact or target.get("impact", "")
        target["recommendation"] = explanation.recommendation or target.get("recommendation", "")
        target["confidence"] = min(target.get("confidence", 1.0), explanation.confidence)
        target["source"] = "llm_reviewer"
        target["reviewer_node"] = reviewer_node
    return findings
