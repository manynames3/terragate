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
    title = finding.get("title", "").lower()
    resource_type = finding.get("resource_type", "")
    if "public ingress" in title:
        return {
            "language": "hcl",
            "snippet": (
                'ingress {\n'
                '  description = "Admin access from approved network"\n'
                "  from_port   = 22\n"
                "  to_port     = 22\n"
                '  protocol    = "tcp"\n'
                "  cidr_blocks = var.approved_admin_cidrs\n"
                "}"
            ),
            "explanation": "Replace world-open ingress with an approved CIDR variable or remove SSH/RDP entirely in favor of SSM.",
            "risk_of_change": "medium",
        }
    if "rds" in title and "public" in title:
        return {
            "language": "hcl",
            "snippet": "publicly_accessible = false\nvpc_security_group_ids = [aws_security_group.db_private.id]",
            "explanation": "Keep the database endpoint private and route access through private networking.",
            "risk_of_change": "high",
        }
    if resource_type == "aws_db_instance" and "storage encryption" in title:
        return {
            "language": "hcl",
            "snippet": "storage_encrypted = true\nkms_key_id        = aws_kms_key.rds.arn",
            "explanation": "Enables RDS encryption at rest with a managed or customer-managed KMS key.",
            "risk_of_change": "high",
        }
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
                '  actions   = ["s3:GetObject", "s3:ListBucket"]\n'
                "  resources = [aws_s3_bucket.app.arn, \"${aws_s3_bucket.app.arn}/*\"]\n"
                "}"
            ),
            "explanation": "Replace wildcard IAM privileges with the minimum service actions and resource ARNs.",
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
