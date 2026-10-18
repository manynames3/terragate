from collections import Counter
from html import escape
import re
from urllib.parse import quote, urlsplit
from typing import Any

from app.graph.terraform_review.nodes.common import mark_node
from app.services.risk import score_risk


def report_builder(state: dict[str, Any]) -> dict[str, Any]:
    findings = state.get("merged_findings", [])
    risk_score = score_risk(
        findings,
        state.get("environment", "dev"),
        cost_estimate=state.get("cost_estimate", {}),
        blast_radius=state.get("blast_radius", {}),
    )
    safe_state, safe_findings, safe_score = _display(state), _display(findings), _display(risk_score)
    comment = _build_pr_comment(safe_state, safe_findings, safe_score)
    report = _build_report(safe_state, safe_findings, safe_score, comment)
    assessment = state.get("grounded_assessment")
    if assessment:
        details = ["", "## Grounded reviewer", f"Status: {_text(assessment['status'])}",
                   f"Assessment: {_text(assessment['classification'])}",
                   "Rule heuristics are not calibrated probabilities. Citation validity is separate from semantic support."]
        details += [f"- {_text(warning)}" for warning in assessment.get("warnings", [])]
        for finding in findings:
            grounding = finding.get("grounding", {})
            if grounding.get("interpretation_source"):
                details += [f"### {_text(finding['resource_address'])}",
                            f"Interpretation: {_text(finding['impact'])}"]
                details += [f"- Missing context: {_text(item)}" for item in grounding.get("missing_context", [])]
                for doc in grounding.get("documents", []):
                    # URLs come exclusively from the versioned corpus, never the model.
                    details.append(f"- [{_text(doc['id'])}: {_text(doc['title'])}]({doc['url']}) — {_text(doc['passage'])}")
        report += "\n" + "\n".join(details)
        comment += f"\n\nGrounded review: {_text(assessment['status'])}; {_text(assessment['classification'])}. See full report for evidence and uncertainty."
    return {
        **mark_node(state, "report_builder"),
        "risk_score": risk_score,
        "pr_comment_draft": comment,
        "report_markdown": report,
    }


def _text(value):
    return re.sub(r"([\\`*_[\]{}()!|>#])", r"\\\1", escape(str(value), quote=True)).replace("\n", " ")


def _display(value):
    if isinstance(value, str):
        return _text(value)
    if isinstance(value, list):
        return [_display(item) for item in value]
    if isinstance(value, dict):
        result = {}
        for key, item in value.items():
            if key == "snippet" and isinstance(item, str):
                result[key] = item.replace("```", "` ` `")
            elif key == "pr_file_url" and isinstance(item, str):
                parsed = urlsplit(item)
                result[key] = quote(item, safe=":/%?=#&.-_") if parsed.scheme == "https" and parsed.hostname in {"github.com", "raw.githubusercontent.com"} else None
            else:
                result[key] = _display(item)
        return result
    return value


def _build_pr_comment(
    state: dict[str, Any], findings: list[dict[str, Any]], risk_score: dict[str, Any]
) -> str:
    counts = Counter(finding.get("severity", "info") for finding in findings)
    lines = [
        "## TerraGate Review",
        "",
        f"Overall risk: {risk_score['risk_level'].title()} ({risk_score['overall_score']}/100)",
        (
            f"Findings: {counts.get('critical', 0)} critical, {counts.get('high', 0)} high, "
            f"{counts.get('medium', 0)} medium, {counts.get('low', 0)} low"
        ),
        f"Environment: {state.get('environment', 'dev')}",
        f"Run ID: {state.get('run_id')}",
    ]
    github_context = (state.get("repo_context") or {}).get("github_pr_context") or {}
    if github_context:
        repo = github_context.get("repo_full_name") or _repo_name(state)
        pull_number = github_context.get("pull_number")
        title = github_context.get("title")
        lines.append(
            f"GitHub PR: {repo}#{pull_number}"
            if repo and pull_number
            else "GitHub PR: metadata unavailable"
        )
        lines.append(
            f"PR title: {title}"
            if title
            else f"PR context: {github_context.get('message', 'not available')}"
        )
    lines.extend(["", "### Top risks"])
    top = findings[:5]
    if not top:
        lines.append("No material risks were detected by deterministic policy checks.")
    for index, finding in enumerate(top, start=1):
        evidence = finding.get("evidence", [{}])[0]
        lines.extend(
            [
                f"{index}. {finding.get('severity', 'info').title()} - {finding.get('title')}",
                f"   - Resource: {finding.get('resource_address') or 'n/a'}",
                _pr_file_line(finding),
                f"   - Evidence: {evidence.get('explanation', 'See finding evidence.')}",
                f"   - Recommendation: {finding.get('recommendation')}",
            ]
        )
        checklist = finding.get("runbook_checklist") or []
        if checklist:
            lines.extend(["   - Runbook checklist:"] + [f"     - {item}" for item in checklist[:4]])
        lines.append("")

    remediation_lines = []
    for finding in findings:
        remediation = finding.get("remediation")
        if remediation:
            remediation_lines.extend(
                [
                    f"#### {finding.get('title')}",
                    "```hcl",
                    remediation["snippet"],
                    "```",
                ]
            )
        if len(remediation_lines) > 18:
            break

    if remediation_lines:
        lines.extend(["### Suggested remediation", *remediation_lines])
    runbook_lines = _runbook_lines(findings)
    if runbook_lines:
        lines.extend(["", "### Operational checklist", *runbook_lines])
    lines.append("")
    lines.append("Human approval required before posting.")
    return "\n".join(lines)


def _build_report(
    state: dict[str, Any],
    findings: list[dict[str, Any]],
    risk_score: dict[str, Any],
    comment: str,
) -> str:
    plan_summary = state.get("plan_summary", {})
    lines = [
        "# Terraform PR Review Report",
        "",
        f"Risk level: **{risk_score['risk_level'].title()}**",
        f"Risk score: **{risk_score['overall_score']}/100**",
        "",
        "## Plan summary",
        f"- Resources changed: {plan_summary.get('total_resource_changes', 0)}",
        f"- Creates: {plan_summary.get('creates', 0)}",
        f"- Updates: {plan_summary.get('updates', 0)}",
        f"- Deletes: {plan_summary.get('deletes', 0)}",
        f"- Replacements: {plan_summary.get('replacements', 0)}",
        "",
        "## Findings",
    ]
    if not findings:
        lines.append("No findings.")
    for finding in findings:
        lines.extend(
            [
                f"### {finding.get('severity', 'info').title()} - {finding.get('title')}",
                finding.get("description", ""),
                f"Resource: `{finding.get('resource_address')}`",
                f"PR file: {_pr_file_text(finding)}",
                f"Recommendation: {finding.get('recommendation')}",
                "",
            ]
        )
        checklist = finding.get("runbook_checklist") or []
        if checklist:
            lines.extend(["Runbook checklist:", *[f"- {item}" for item in checklist], ""])
    lines.extend(["## PR comment draft", "", comment])
    return "\n".join(lines)


def _runbook_lines(findings: list[dict[str, Any]]) -> list[str]:
    seen: set[str] = set()
    lines: list[str] = []
    for finding in findings:
        for item in finding.get("runbook_checklist") or []:
            if item in seen:
                continue
            seen.add(item)
            lines.append(f"- {item}")
        if len(lines) >= 8:
            break
    return lines


def _repo_name(state: dict[str, Any]) -> str | None:
    repo_context = state.get("repo_context") or {}
    owner = repo_context.get("repo_owner")
    repo = repo_context.get("repo_name")
    if owner and repo:
        return f"{owner}/{repo}"
    return None


def _pr_file_line(finding: dict[str, Any]) -> str:
    path = finding.get("pr_file_path")
    url = finding.get("pr_file_url")
    if not path:
        return "   - PR file: not mapped"
    if url:
        return f"   - PR file: [{path}]({url})"
    return f"   - PR file: {path}"


def _pr_file_text(finding: dict[str, Any]) -> str:
    path = finding.get("pr_file_path")
    url = finding.get("pr_file_url")
    if not path:
        return "not mapped"
    if url:
        return f"[{path}]({url})"
    return path
