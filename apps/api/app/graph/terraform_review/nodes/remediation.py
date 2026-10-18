from typing import Any

from app.graph.terraform_review.nodes.common import mark_node


def generate_remediations(state: dict[str, Any]) -> dict[str, Any]:
    findings = []
    remediations = []
    for finding in state.get("merged_findings", []):
        remediation = _remediation_for(finding)
        runbook_checklist = _runbook_checklist_for(finding)
        if remediation:
            finding = {**finding, "remediation": remediation}
            remediations.append({"finding_id": finding["id"], **remediation})
        if runbook_checklist:
            finding = {**finding, "runbook_checklist": runbook_checklist}
        findings.append(finding)
    summary = f"Generated {len(remediations)} Terraform remediation snippets for review."
    return {
        **mark_node(state, "generate_remediations"),
        "merged_findings": findings,
        "remediations": remediations,
        "remediation_summary": summary,
    }


def _remediation_for(finding: dict[str, Any]) -> dict[str, Any] | None:
    if finding.get("source") == "llm_reviewer":
        return None  # A validated interpretation is not an executable Terraform patch.
    title = finding.get("title", "").lower()
    resource_type = finding.get("resource_type", "")
    if "public ingress" in title:
        observed = next((e.get("observed_value") for e in finding.get("evidence", []) if isinstance(e.get("observed_value"), dict)), {})
        port = observed.get("from_port")
        if resource_type != "aws_security_group" or not isinstance(port, int) or port != observed.get("to_port") or not 1 <= port <= 65535:
            return None
        return {
            "language": "hcl",
            "snippet": (
                'ingress {\n'
                '  description = "Admin access from approved network"\n'
                f"  from_port   = {port}\n"
                f"  to_port     = {port}\n"
                '  protocol    = "tcp"\n'
                "  cidr_blocks = var.approved_admin_cidrs\n"
                "}"
            ),
            "explanation": "Example only: define approved_admin_cidrs with the owner and preserve the intended service port. Verify protocol, IPv6 sources, routes and emergency access before editing.",
            "risk_of_change": "medium",
        }
    if "rds" in title and "public" in title:
        return {
            "language": "hcl",
            "snippet": "publicly_accessible = false",
            "explanation": "Review private client connectivity, security groups and subnet routing with the owner before changing public addressing.",
            "risk_of_change": "high",
        }
    if resource_type == "aws_db_instance" and "storage encryption" in title:
        return None  # Existing unencrypted RDS requires snapshot-copy/restore planning.
    if "storage encryption" in title or "bucket encryption" in title:
        return {
            "language": "hcl",
            "snippet": (
                'resource "aws_s3_bucket_server_side_encryption_configuration" "this" {\n'
                "  bucket = aws_s3_bucket.this.id\n\n"
                "  rule {\n"
                "    apply_server_side_encryption_by_default {\n"
                '      sse_algorithm = "AES256"\n'
                "    }\n"
                "  }\n"
                "}"
            ),
            "explanation": "Adds default server-side encryption for new objects.",
            "risk_of_change": "low",
        }
    if "public access block" in title:
        return {
            "language": "hcl",
            "snippet": (
                'resource "aws_s3_bucket_public_access_block" "this" {\n'
                "  bucket                  = aws_s3_bucket.this.id\n"
                "  block_public_acls       = true\n"
                "  block_public_policy     = true\n"
                "  ignore_public_acls      = true\n"
                "  restrict_public_buckets = true\n"
                "}"
            ),
            "explanation": "Enables all S3 public access block controls.",
            "risk_of_change": "low",
        }
    if "wildcard" in title:
        return {
            "language": "hcl",
            "snippet": (
                "statement {\n"
                "  actions   = var.required_actions\n"
                "  resources = var.required_resource_arns\n"
                "}"
            ),
            "explanation": "Example placeholders: define required_actions and required_resource_arns from observed workload needs. Verify action/resource compatibility and test before applying.",
            "risk_of_change": "medium",
        }
    if "cost_center" in title or "governance tags" in title:
        return {
            "language": "hcl",
            "snippet": (
                "tags = merge(var.default_tags, {\n"
                '  owner       = "platform"\n'
                '  environment = var.environment\n'
                '  service     = "example-service"\n'
                '  cost_center = "cc-1234"\n'
                "})"
            ),
            "explanation": "Adds required ownership and cost allocation tags.",
            "risk_of_change": "low",
        }
    if resource_type == "aws_db_instance" and ("backup" in title or "deletion protection" in title):
        return {
            "language": "hcl",
            "snippet": "backup_retention_period = 7\ndeletion_protection     = true",
            "explanation": "Improves recovery and prevents accidental production database deletion.",
            "risk_of_change": "low",
        }
    if "large ec2" in title:
        return {
            "language": "hcl",
            "snippet": 'instance_type = var.environment == "prod" ? "m7i.large" : "t3.medium"',
            "explanation": "Uses environment-aware sizing so dev and staging are not over-provisioned.",
            "risk_of_change": "medium",
        }
    return None


def _runbook_checklist_for(finding: dict[str, Any]) -> list[str]:
    severity = finding.get("severity", "info")
    actions = set(finding.get("change_actions") or [])
    resource_type = finding.get("resource_type")
    title = str(finding.get("title", "")).lower()
    if severity not in {"critical", "high"} and "delete" not in actions:
        return []

    checklist = [
        "Confirm named owner is accountable for the change window.",
        "Record approval or exception for the selected policy pack.",
        "Define validation checks that prove the service is healthy after apply.",
    ]
    if resource_type in {"aws_db_instance", "aws_ebs_volume", "aws_efs_file_system", "aws_dynamodb_table", "aws_s3_bucket", "aws_opensearch_domain"} or "stateful" in title:
        checklist = [
            "Backup verified and restore point recorded.",
            "Maintenance window scheduled and communicated.",
            "Rollback plan documented with owner and time limit.",
            "Downstream dependencies and consumers identified.",
            "Owner signoff captured before apply.",
            "Post-apply data validation and smoke tests defined.",
        ]
    elif "public ingress" in title or "publicly accessible" in title:
        checklist.extend(
            [
                "Confirm approved source CIDR or private access path.",
                "Validate emergency access path such as SSM or VPN.",
                "Schedule post-change external exposure scan.",
            ]
        )
    elif "wildcard" in title:
        checklist.extend(
            [
                "Identify exact actions used by the workload.",
                "Test least-privilege policy in non-production.",
                "Confirm rollback path for permission-denied production impact.",
            ]
        )
    return checklist
