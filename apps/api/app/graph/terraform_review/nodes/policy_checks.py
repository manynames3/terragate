from __future__ import annotations

import json
import re
from typing import Any

from app.graph.terraform_review.nodes.common import (
    make_evidence,
    make_finding,
    mark_node,
    resource_json_path,
)
from app.services.policy_packs import PolicyPack, load_policy_pack
from app.services.terraform_plan import get_attr, get_tags, is_create_or_update, is_delete_or_replace


DANGEROUS_PORTS = {22, 3389, 3306, 5432, 6379, 9200}
STATEFUL_TYPES = {
    "aws_db_instance",
    "aws_ebs_volume",
    "aws_efs_file_system",
    "aws_dynamodb_table",
    "aws_s3_bucket",
}
REQUIRED_TAGS = {"owner", "environment", "service", "cost_center"}
ALLOWED_REGIONS = {"us-east-1", "us-east-2", "us-west-2"}
RESTRICTED_PROFILE_ALLOWLIST = {
    "aws_security_group",
    "aws_s3_bucket",
    "aws_s3_bucket_public_access_block",
    "aws_s3_bucket_server_side_encryption_configuration",
    "aws_iam_policy",
    "aws_iam_role_policy",
    "aws_db_instance",
}


def deterministic_policy_checks(state: dict[str, Any]) -> dict[str, Any]:
    policy_pack = load_policy_pack(state.get("policy_profile", "default"))
    findings = run_policy_checks(
        state.get("resource_changes", []),
        environment=state.get("environment", "dev"),
        policy_profile=state.get("policy_profile", "default"),
        policy_pack=policy_pack,
        sensitive_paths=state.get("sensitive_paths", []),
    )
    return {
        **mark_node(state, "deterministic_policy_checks"),
        "deterministic_results": findings,
        "policy_pack": policy_pack.to_dict(),
    }


def run_policy_checks(
    resource_changes: list[dict[str, Any]],
    *,
    environment: str,
    policy_profile: str,
    policy_pack: PolicyPack | None = None,
    sensitive_paths: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    policy_pack = policy_pack or load_policy_pack(policy_profile)
    findings: list[dict[str, Any]] = []
    s3_buckets = {
        _bucket_name(get_attr(resource, "bucket")) or resource.get("name"): resource
        for resource in resource_changes
        if resource.get("type") == "aws_s3_bucket" and is_create_or_update(resource)
    }
    public_access_blocks = {
        _bucket_name(get_attr(resource, "bucket")): resource
        for resource in resource_changes
        if resource.get("type") == "aws_s3_bucket_public_access_block"
    }
    encryption_configs = {
        _bucket_name(get_attr(resource, "bucket")): resource
        for resource in resource_changes
        if resource.get("type") == "aws_s3_bucket_server_side_encryption_configuration"
    }

    for resource in resource_changes:
        findings.extend(_security_checks(resource, policy_pack))
        findings.extend(_cost_checks(resource, environment, policy_pack))
        findings.extend(_reliability_checks(resource, environment, policy_pack))
        findings.extend(_governance_checks(resource, environment, policy_profile, policy_pack))

    for bucket_name, bucket in s3_buckets.items():
        if bucket_name and bucket_name not in public_access_blocks:
            findings.append(
                make_finding(
                    title="S3 public access block not visible in plan",
                    description="A new or changed S3 bucket has no matching public access block resource in the plan.",
                    severity="medium",
                    category="security",
                    resource=bucket,
                    evidence=[
                        make_evidence(
                            resource_json_path(bucket, "change.after.bucket"),
                            bucket_name,
                            "aws_s3_bucket_public_access_block with all block settings enabled",
                            "SEC-S3-001",
                            "Public access block could not be confirmed from this plan.",
                        )
                    ],
                    impact="Bucket policy or ACL drift could expose objects publicly.",
                    recommendation="Add aws_s3_bucket_public_access_block with block_public_acls, block_public_policy, ignore_public_acls, and restrict_public_buckets enabled.",
                )
            )
        if bucket_name and bucket_name not in encryption_configs:
            findings.append(
                make_finding(
                    title="S3 bucket encryption not visible in plan",
                    description="A new or changed S3 bucket has no matching server-side encryption configuration in the plan.",
                    severity="medium",
                    category="security",
                    resource=bucket,
                    evidence=[
                        make_evidence(
                            resource_json_path(bucket, "change.after.bucket"),
                            bucket_name,
                            "aws_s3_bucket_server_side_encryption_configuration",
                            "SEC-S3-002",
                            "Server-side encryption could not be confirmed from this plan.",
                        )
                    ],
                    impact="Objects may be stored without explicit encryption controls.",
                    recommendation="Configure default server-side encryption with SSE-S3 or KMS.",
                )
            )

    if sensitive_paths:
        representative = resource_changes[0] if resource_changes else {"address": "terraform_plan"}
        findings.append(
            make_finding(
                title="Sensitive values detected in Terraform plan",
                description="The plan contains keys that look like secrets and were redacted before AI review.",
                severity="high",
                category="security",
                resource=representative,
                evidence=[
                    make_evidence(
                        item["json_path"],
                        "[REDACTED]",
                        "No secrets in Terraform plan JSON",
                        "SEC-SECRET-001",
                        item["explanation"],
                    )
                    for item in sensitive_paths[:5]
                ],
                impact="Terraform plan files can leak credentials through CI logs, artifacts, or AI prompts.",
                recommendation="Move secrets to a secrets manager and avoid committing or uploading raw plan files outside trusted systems.",
                confidence=1.0,
                requires_human_review=True,
            )
        )

    return findings


def _security_checks(resource: dict[str, Any], policy_pack: PolicyPack) -> list[dict[str, Any]]:
    resource_type = resource.get("type")
    findings: list[dict[str, Any]] = []
    if not is_create_or_update(resource):
        return findings

    if resource_type == "aws_security_group" and policy_pack.block_public_admin_ingress:
        for index, ingress in enumerate(get_attr(resource, "ingress") or []):
            findings.extend(_check_ingress(resource, ingress, f"change.after.ingress[{index}]"))

    if resource_type == "aws_vpc_security_group_ingress_rule" and policy_pack.block_public_admin_ingress:
        ingress = {
            "from_port": get_attr(resource, "from_port"),
            "to_port": get_attr(resource, "to_port"),
            "cidr_blocks": [get_attr(resource, "cidr_ipv4")] if get_attr(resource, "cidr_ipv4") else [],
            "ipv6_cidr_blocks": [get_attr(resource, "cidr_ipv6")] if get_attr(resource, "cidr_ipv6") else [],
        }
        findings.extend(_check_ingress(resource, ingress, "change.after"))

    if resource_type == "aws_s3_bucket_public_access_block":
        disabled = [
            key
            for key in (
                "block_public_acls",
                "block_public_policy",
                "ignore_public_acls",
                "restrict_public_buckets",
            )
            if get_attr(resource, key) is False
        ]
        if disabled:
            findings.append(
                make_finding(
                    title="S3 public access block disabled",
                    description="One or more S3 public access block controls are disabled.",
                    severity="high",
                    category="security",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, f"change.after.{key}"),
                            False,
                            True,
                            "SEC-S3-003",
                            f"{key} should be enabled.",
                        )
                        for key in disabled
                    ],
                    impact="Public ACLs or bucket policies may expose data.",
                    recommendation="Enable all S3 public access block controls unless there is a documented exception.",
                )
            )

    if resource_type == "aws_db_instance":
        if get_attr(resource, "publicly_accessible") is True:
            findings.append(
                make_finding(
                    title="RDS instance is publicly accessible",
                    description="The RDS instance allows public network access.",
                    severity="high",
                    category="security",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.publicly_accessible"),
                            True,
                            False,
                            "SEC-RDS-001",
                            "RDS databases should not be publicly reachable.",
                        )
                    ],
                    impact="Database endpoints exposed to the internet increase breach and brute-force risk.",
                    recommendation="Place RDS in private subnets and require access through private networking or controlled bastion/SSM workflows.",
                )
            )
        if get_attr(resource, "storage_encrypted") is False:
            findings.append(
                make_finding(
                    title="RDS storage encryption disabled",
                    description="The RDS instance does not enable storage encryption.",
                    severity="high",
                    category="security",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.storage_encrypted"),
                            False,
                            True,
                            "SEC-RDS-002",
                            "RDS storage should be encrypted at rest.",
                        )
                    ],
                    impact="Database snapshots and storage may not satisfy encryption-at-rest requirements.",
                    recommendation="Set storage_encrypted = true and use a managed or customer-managed KMS key.",
                )
            )

    if resource_type in {"aws_iam_policy", "aws_iam_role_policy", "aws_iam_user_policy"}:
        policy = get_attr(resource, "policy")
        wildcard_evidence = _wildcard_policy_evidence(policy)
        if wildcard_evidence:
            findings.append(
                make_finding(
                    title="IAM policy uses wildcard permissions",
                    description="The IAM policy grants wildcard action or resource permissions.",
                    severity="high",
                    category="security",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.policy"),
                            wildcard_evidence,
                            "Least privilege actions and resources",
                            "SEC-IAM-001",
                            "Wildcard IAM policies should be narrowed to required actions and resources.",
                        )
                    ],
                    impact="Overbroad IAM policies can allow privilege escalation or broad data access.",
                    recommendation="Replace Action '*' and Resource '*' with service-specific actions and scoped ARNs.",
                )
            )

    return findings


def _cost_checks(resource: dict[str, Any], environment: str, policy_pack: PolicyPack) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not is_create_or_update(resource):
        return findings

    resource_type = resource.get("type")
    tags = get_tags(resource)
    if resource_type == "aws_instance":
        instance_type = get_attr(resource, "instance_type")
        family = str(instance_type).split(".")[0] if instance_type else ""
        if policy_pack.allowed_instance_families and family and family not in policy_pack.allowed_instance_families:
            findings.append(
                make_finding(
                    title="Instance family outside policy pack",
                    description="The EC2 instance family is not allowed by the selected policy pack.",
                    severity="medium",
                    category="cost",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.instance_type"),
                            instance_type,
                            sorted(policy_pack.allowed_instance_families),
                            "COST-EC2-002",
                            "Policy packs can limit instance families to keep spend and operational support predictable.",
                        )
                    ],
                    impact="Unsupported instance families can create avoidable cost or support burden.",
                    recommendation="Use an approved instance family or request a documented policy exception.",
                    requires_human_review=True,
                )
            )
        if environment in {"dev", "staging"} and _large_instance(instance_type):
            findings.append(
                make_finding(
                    title="Large EC2 instance in non-production",
                    description="A large EC2 instance size is planned in a non-production environment.",
                    severity="medium",
                    category="cost",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.instance_type"),
                            instance_type,
                            "Small or rightsized non-production instance",
                            "COST-EC2-001",
                            "Large instances in dev/staging often indicate avoidable spend.",
                        )
                    ],
                    impact="Non-production compute costs may grow quickly without utilization evidence.",
                    recommendation="Use a smaller instance class or document the load-test/performance reason for this size.",
                )
            )

    if resource_type == "aws_db_instance" and environment in {"dev", "staging"}:
        if get_attr(resource, "multi_az") is True and str(tags.get("required", "")).lower() != "true":
            findings.append(
                make_finding(
                    title="RDS Multi-AZ enabled in non-production",
                    description="Multi-AZ RDS is enabled in a non-production environment without an explicit required tag.",
                    severity="medium",
                    category="cost",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.multi_az"),
                            True,
                            "false or tag required=true",
                            "COST-RDS-001",
                            "Multi-AZ roughly doubles instance and storage footprint.",
                        )
                    ],
                    impact="Database availability spend may be higher than needed for dev or staging.",
                    recommendation="Disable Multi-AZ in non-production or tag the resource with required=true and a justification.",
                )
            )

    if resource_type == "aws_ebs_volume":
        size = get_attr(resource, "size")
        iops = get_attr(resource, "iops")
        if isinstance(size, int) and size >= 1000:
            findings.append(
                make_finding(
                    title="Large EBS volume provisioned",
                    description="A large EBS volume is being created or updated.",
                    severity="medium",
                    category="cost",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.size"),
                            size,
                            "< 1000 GiB unless justified",
                            "COST-EBS-001",
                            "Large volumes can create persistent monthly cost.",
                        )
                    ],
                    impact="Storage spend can remain high even when compute scales down.",
                    recommendation="Right-size the volume and add lifecycle monitoring for utilization.",
                )
            )
        if isinstance(iops, int) and iops >= 10000:
            findings.append(
                make_finding(
                    title="High provisioned EBS IOPS",
                    description="The EBS volume provisions high IOPS.",
                    severity="medium",
                    category="cost",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.iops"),
                            iops,
                            "< 10000 unless benchmarked",
                            "COST-EBS-002",
                            "Provisioned IOPS should be tied to benchmarked throughput needs.",
                        )
                    ],
                    impact="Provisioned IOPS can materially increase storage cost.",
                    recommendation="Use gp3 baseline defaults or document a benchmark-backed IOPS requirement.",
                )
            )

    if resource_type == "aws_nat_gateway":
        findings.append(
            make_finding(
                title="NAT Gateway creation adds recurring network cost",
                description="A NAT Gateway is being created.",
                severity="low",
                category="cost",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "type"),
                        "aws_nat_gateway",
                        "NAT gateway only when required",
                        "COST-NET-001",
                        "NAT gateways have hourly and data processing charges.",
                    )
                ],
                impact="Idle or duplicated NAT gateways can become persistent network spend.",
                recommendation="Confirm private subnet egress requirements and consolidate NAT gateways where availability requirements allow.",
            )
        )

    if resource_type in {"aws_opensearch_domain", "aws_elasticsearch_domain"}:
        findings.append(
            make_finding(
                title="Search domain creation can create high baseline cost",
                description="An OpenSearch or Elasticsearch domain is being created.",
                severity="medium",
                category="cost",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "type"),
                        resource_type,
                        "Capacity plan and retention policy",
                        "COST-SEARCH-001",
                        "Managed search clusters have continuous compute and storage costs.",
                    )
                ],
                impact="Search domains can incur fixed spend even at low traffic.",
                recommendation="Confirm shard sizing, retention, and autoscaling before applying.",
            )
        )

    if policy_pack.require_cost_center and is_create_or_update(resource) and tags is not None and not tags.get("cost_center"):
        findings.append(
            make_finding(
                title="Missing cost_center tag",
                description="The resource is missing the required cost_center tag.",
                severity="low",
                category="cost",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.after.tags.cost_center"),
                        None,
                        "cost_center tag",
                        "COST-TAG-001",
                        "Cost allocation requires a cost_center tag.",
                    )
                ],
                impact="Unallocated cloud spend is harder to attribute and optimize.",
                recommendation="Add a cost_center tag using the team or service cost allocation code.",
            )
        )

    return findings


def _reliability_checks(resource: dict[str, Any], environment: str, policy_pack: PolicyPack) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    resource_type = resource.get("type")
    actions = resource.get("change", {}).get("actions", [])

    if resource_type == "aws_db_instance" and is_delete_or_replace(resource):
        findings.append(
            make_finding(
                title="RDS replacement or deletion planned",
                description="The plan deletes or replaces an RDS instance.",
                severity="high" if environment == "prod" else "medium",
                category="reliability",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.actions"),
                        actions,
                        "No destructive database actions without runbook",
                        "REL-RDS-001",
                        "RDS destructive changes can cause outage or data loss.",
                    )
                ],
                impact="Database replacement may create downtime, data loss, or rollback complexity.",
                recommendation="Confirm backups, maintenance window, snapshot restore testing, and rollback plan before apply.",
                requires_human_review=True,
            )
        )

    if resource_type in STATEFUL_TYPES and "delete" in actions and "create" in actions:
        findings.append(
            make_finding(
                title="Stateful resource replacement planned",
                description="The plan replaces a stateful resource.",
                severity="high" if environment == "prod" else "medium",
                category="reliability",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.actions"),
                        actions,
                        "No replacement unless migration plan exists",
                        "REL-STATEFUL-001",
                        "Stateful replacement should be reviewed manually.",
                    )
                ],
                impact="Replacement can interrupt service or remove persistent data.",
                recommendation="Add migration, backup, restore, and validation steps to the deployment runbook.",
                requires_human_review=True,
            )
        )

    if (
        environment == "prod"
        and policy_pack.block_production_stateful_deletes
        and resource_type in STATEFUL_TYPES
        and "delete" in actions
    ):
        findings.append(
            make_finding(
                title="Production stateful deletion blocked by policy",
                description="The selected policy pack blocks production deletion or replacement of stateful resources without an exception.",
                severity="critical",
                category="reliability",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.actions"),
                        actions,
                        "No production stateful deletes without break-glass approval",
                        "REL-STATEFUL-002",
                        "Production stateful deletes carry outage and data-loss risk.",
                    )
                ],
                impact="This change can remove persistent data or force an outage in production.",
                recommendation="Stop the apply until backup verification, rollback plan, owner signoff, and a maintenance window are recorded.",
                requires_human_review=True,
            )
        )

    if resource_type == "aws_db_instance" and environment == "prod":
        backup_retention = get_attr(resource, "backup_retention_period")
        deletion_protection = get_attr(resource, "deletion_protection")
        multi_az = get_attr(resource, "multi_az")
        if backup_retention is None or int(backup_retention or 0) < policy_pack.min_prod_backup_retention_days:
            findings.append(
                make_finding(
                    title="Production RDS backup retention missing",
                    description="Production RDS backup retention is zero or absent.",
                    severity="high",
                    category="reliability",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.backup_retention_period"),
                            backup_retention,
                            f">= {policy_pack.min_prod_backup_retention_days}",
                            "REL-RDS-002",
                            "Production databases should retain automated backups.",
                        )
                    ],
                    impact="Recovery point objectives may not be achievable after data corruption or accidental deletion.",
                    recommendation=f"Set backup_retention_period to at least {policy_pack.min_prod_backup_retention_days} days for production databases.",
                )
            )
        if policy_pack.require_deletion_protection_in_prod and deletion_protection is False:
            findings.append(
                make_finding(
                    title="Production RDS deletion protection disabled",
                    description="Deletion protection is disabled for a production RDS instance.",
                    severity="high",
                    category="reliability",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.deletion_protection"),
                            False,
                            True,
                            "REL-RDS-003",
                            "Production RDS instances should enable deletion protection.",
                        )
                    ],
                    impact="A misapplied Terraform change can destroy a production database.",
                    recommendation="Set deletion_protection = true and use an explicit break-glass workflow for deletes.",
                )
            )
        if multi_az is False:
            findings.append(
                make_finding(
                    title="Production RDS appears single-AZ",
                    description="A production RDS instance has multi_az disabled.",
                    severity="medium",
                    category="reliability",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.multi_az"),
                            False,
                            True,
                            "REL-RDS-004",
                            "Production databases should use Multi-AZ where availability requirements apply.",
                        )
                    ],
                    impact="Single-AZ databases have higher outage exposure during AZ impairment or maintenance.",
                    recommendation="Enable Multi-AZ or document why this production database is exempt.",
                )
            )

    if resource_type == "aws_lb_target_group":
        health_check = get_attr(resource, "health_check")
        if not health_check:
            findings.append(
                make_finding(
                    title="Target group health check not visible",
                    description="The target group does not show a health check configuration.",
                    severity="medium",
                    category="reliability",
                    resource=resource,
                    evidence=[
                        make_evidence(
                            resource_json_path(resource, "change.after.health_check"),
                            health_check,
                            "health_check block",
                            "REL-LB-001",
                            "Load balancer target groups should have explicit health checks.",
                        )
                    ],
                    impact="Traffic may continue routing to unhealthy targets or fail unpredictably.",
                    recommendation="Add an explicit health_check block with path, matcher, interval, and thresholds.",
                )
            )

    return findings


def _governance_checks(
    resource: dict[str, Any], environment: str, policy_profile: str, policy_pack: PolicyPack
) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    if not is_create_or_update(resource):
        return findings

    tags = get_tags(resource)
    missing = sorted(tag for tag in policy_pack.required_tags if tag not in tags or not tags.get(tag))
    if missing:
        findings.append(
            make_finding(
                title="Required governance tags missing",
                description="The resource is missing one or more required tags.",
                severity="low",
                category="governance",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.after.tags"),
                        tags,
                        sorted(policy_pack.required_tags),
                        "GOV-TAG-001",
                        f"Missing tags: {', '.join(missing)}.",
                    )
                ],
                impact="Ownership, incident routing, cost attribution, and inventory controls are weaker.",
                recommendation="Add owner, environment, service, and cost_center tags to the resource or module defaults.",
            )
        )

    tag_environment = tags.get("environment")
    if tag_environment and str(tag_environment).lower() != environment:
        findings.append(
            make_finding(
                title="Environment tag mismatch",
                description="The resource environment tag does not match the selected review environment.",
                severity="medium",
                category="governance",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.after.tags.environment"),
                        tag_environment,
                        environment,
                        "GOV-TAG-002",
                        "Environment tags should match the deployment context.",
                    )
                ],
                impact="Policy, monitoring, and cost rules may apply the wrong environment assumptions.",
                recommendation="Correct the environment tag or rerun the review using the intended environment.",
            )
        )

    region = get_attr(resource, "region")
    if region and region not in policy_pack.allowed_regions:
        findings.append(
            make_finding(
                title="Region outside allowed list",
                description="The resource is configured for a region outside the approved list.",
                severity="medium",
                category="governance",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.after.region"),
                        region,
                            sorted(policy_pack.allowed_regions),
                        "GOV-REGION-001",
                        "Region controls support data residency and operational coverage.",
                    )
                ],
                impact="Unapproved regions can violate support, latency, or data residency controls.",
                recommendation="Move the resource to an approved region or request a policy exception.",
            )
        )

    restricted_allowlist = policy_pack.restricted_allowlist or RESTRICTED_PROFILE_ALLOWLIST
    if policy_profile == "restricted" and resource.get("type") not in restricted_allowlist:
        findings.append(
            make_finding(
                title="Resource type outside restricted policy profile",
                description="The selected policy profile does not allow this resource type by default.",
                severity="medium",
                category="governance",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "type"),
                        resource.get("type"),
                            sorted(restricted_allowlist),
                        "GOV-PROFILE-001",
                        "Restricted profiles require explicit allowlisting.",
                    )
                ],
                impact="The change may bypass platform guardrails for restricted environments.",
                recommendation="Use an approved module/resource type or document a policy exception.",
                requires_human_review=True,
            )
        )

    name = get_attr(resource, "name") or get_attr(resource, "bucket") or get_attr(resource, "identifier")
    if isinstance(name, str) and not re.match(r"^[a-z0-9][a-z0-9-]{2,62}$", name):
        findings.append(
            make_finding(
                title="Naming convention violation",
                description="The resource name does not match the platform naming convention.",
                severity="low",
                category="governance",
                resource=resource,
                evidence=[
                    make_evidence(
                        resource_json_path(resource, "change.after.name"),
                        name,
                        "lowercase kebab-case, 3-63 chars",
                        "GOV-NAME-001",
                        "Names should be predictable for inventory and alert routing.",
                    )
                ],
                impact="Inconsistent names make ownership and operations harder during incidents.",
                recommendation="Use lowercase kebab-case names that include service and environment where practical.",
            )
        )

    return findings


def _check_ingress(resource: dict[str, Any], ingress: dict[str, Any], path: str) -> list[dict[str, Any]]:
    cidrs = list(ingress.get("cidr_blocks") or []) + list(ingress.get("ipv6_cidr_blocks") or [])
    if "0.0.0.0/0" not in cidrs and "::/0" not in cidrs:
        return []
    from_port = ingress.get("from_port")
    to_port = ingress.get("to_port")
    broad_range = from_port in {0, None} and to_port in {0, 65535, None}
    dangerous = [port for port in DANGEROUS_PORTS if _port_in_range(port, from_port, to_port)]
    if not broad_range and not dangerous:
        return []
    target = "broad port range" if broad_range else f"ports {', '.join(map(str, dangerous))}"
    return [
        make_finding(
            title="Public ingress exposes sensitive service",
            description=f"Security group ingress allows internet access to {target}.",
            severity="high",
            category="security",
            resource=resource,
            evidence=[
                make_evidence(
                    resource_json_path(resource, path),
                    {
                        "from_port": from_port,
                        "to_port": to_port,
                        "cidrs": cidrs,
                    },
                    "Restricted CIDR ranges or private access",
                    "SEC-SG-001",
                    "Ingress from 0.0.0.0/0 or ::/0 should not expose administrative or data ports.",
                )
            ],
            impact="The service is reachable from the public internet and may be scanned or attacked.",
            recommendation="Restrict ingress to approved CIDR ranges, a VPN, or SSM Session Manager.",
        )
    ]


def _port_in_range(port: int, from_port: int | None, to_port: int | None) -> bool:
    if from_port is None or to_port is None:
        return False
    return int(from_port) <= port <= int(to_port)


def _bucket_name(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    if value.startswith("${") or "." in value:
        return value.split(".")[-1].replace("}", "")
    return value


def _wildcard_policy_evidence(policy: Any) -> dict[str, Any] | None:
    if isinstance(policy, str):
        try:
            policy = json.loads(policy)
        except json.JSONDecodeError:
            return {"raw_policy_contains_wildcard": '"*" in policy' if '"*"' in policy else "*"}
    if not isinstance(policy, dict):
        return None
    statements = policy.get("Statement") or []
    if isinstance(statements, dict):
        statements = [statements]
    for index, statement in enumerate(statements):
        action = statement.get("Action")
        resource = statement.get("Resource")
        if _has_wildcard(action) or _has_wildcard(resource):
            return {"statement_index": index, "Action": action, "Resource": resource}
    return None


def _has_wildcard(value: Any) -> bool:
    if value == "*":
        return True
    if isinstance(value, list):
        return "*" in value
    return False


def _large_instance(instance_type: Any) -> bool:
    if not isinstance(instance_type, str):
        return False
    return any(marker in instance_type for marker in ("2xlarge", "4xlarge", "8xlarge", "12xlarge", "16xlarge", "24xlarge", "metal")) or instance_type.endswith(".xlarge")
