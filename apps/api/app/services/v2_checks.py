"""Small deterministic additions; these are explicitly rules, not model reasoning."""

import json

from app.graph.terraform_review.nodes.common import (
    make_evidence,
    make_finding,
    resource_json_path,
)
from app.services.terraform_plan import get_attr, is_create_or_update


def statements(value):
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, dict) or not isinstance(
        value.get("Statement"), (list, dict)
    ):
        raise ValueError("Policy structure unavailable")
    values = (
        value["Statement"]
        if isinstance(value["Statement"], list)
        else [value["Statement"]]
    )
    if not values or any(
        not isinstance(s, dict)
        or s.get("Effect") not in {"Allow", "Deny"}
        or not (s.get("Action") or s.get("NotAction"))
        for s in values
    ):
        raise ValueError("Invalid statement")
    return values


def public_principal(value):
    if value == "*":
        return True
    if isinstance(value, list):
        return any(public_principal(v) for v in value)
    return isinstance(value, dict) and any(public_principal(v) for v in value.values())


def additional_checks(resource, *, block_public_admin_ingress=True):
    if not is_create_or_update(resource):
        return []
    findings = []
    kind = resource["type"]

    def add(
        attribute, rule, title, severity, explanation, recommendation, uncertain=False
    ):
        finding = make_finding(
            title=title,
            description=explanation,
            severity=severity,
            category="governance" if uncertain else "security",
            resource=resource,
            evidence=[
                make_evidence(
                    resource_json_path(resource, "change.after." + attribute),
                    get_attr(resource, attribute),
                    None,
                    rule,
                    explanation,
                )
            ],
            impact=explanation,
            recommendation=recommendation,
            requires_human_review=True,
        )
        findings.append(finding)

    for attr in ("assume_role_policy", "policy"):
        value = get_attr(resource, attr)
        if (
            value is None
            or attr == "policy"
            and not (kind.startswith("aws_iam_") or kind == "aws_s3_bucket_policy")
        ):
            continue
        try:
            entries = statements(value)
        except (ValueError, TypeError):
            add(
                attr,
                "GOV-EVIDENCE-001",
                "Policy inputs require verification",
                "medium",
                "The policy document cannot be parsed; its permissions cannot be established.",
                "Review a valid resolved policy with the owner. Do not treat unparsable policy as safe.",
                True,
            )
            continue
        if kind in {"aws_iam_role", "aws_s3_bucket_policy"}:
            for statement in entries:
                if statement.get("Effect") == "Allow" and public_principal(
                    statement.get("Principal")
                ):
                    constrained = bool(statement.get("Condition"))
                    add(
                        attr,
                        "SEC-IAM-TRUST-001"
                        if kind == "aws_iam_role"
                        else "SEC-S3-POLICY-001",
                        "Conditional public principal requires verification"
                        if constrained
                        else "Policy allows a public principal",
                        "medium" if constrained else "high",
                        "The policy names a wildcard principal. Conditions and other access controls determine effective permissions.",
                        "Scope intended principals and review conditions, boundaries and account controls with the owner.",
                        constrained,
                    )
                    break
    if kind in {"aws_s3_bucket", "aws_s3_bucket_acl"} and get_attr(resource, "acl") in {
        "public-read",
        "public-read-write",
        "authenticated-read",
    }:
        add(
            "acl",
            "SEC-S3-ACL-001",
            "S3 ACL permits broad access",
            "high",
            "A broad ACL is planned. Block Public Access and Object Ownership may override it; actual readability is unverified.",
            "Use a private ACL or disable ACLs and verify bucket/account Block Public Access and intended consumers.",
        )
    if (
        block_public_admin_ingress
        and kind == "aws_security_group_rule"
        and get_attr(resource, "type") == "ingress"
    ):
        from app.graph.terraform_review.nodes.policy_checks import _check_ingress

        ingress = {
            k: get_attr(resource, k)
            for k in ("from_port", "to_port", "cidr_blocks", "ipv6_cidr_blocks")
        }
        findings.extend(_check_ingress(resource, ingress, "change.after"))
    return findings
