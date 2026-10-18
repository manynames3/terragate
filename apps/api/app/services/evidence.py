"""Offline, resource/control-scoped retrieval over reviewed documentation summaries."""

from datetime import date
import json
import re
from pathlib import Path

CORPUS = Path(__file__).resolve().parents[1] / "policies" / "evidence-v1.json"
INSTRUCTION = re.compile(
    r"ignore (?:all |previous |prior )?instructions|system prompt|you are now|return only|exfiltrat",
    re.I,
)

# Attributes are also the model's allowlist; descriptions, arbitrary tags and outputs stay local.
CONTROLS = {
    "iam_permissions": {"policy"},
    "iam_trust": {"assume_role_policy"},
    "network": {
        "ingress",
        "cidr_ipv4",
        "cidr_ipv6",
        "cidr_blocks",
        "ipv6_cidr_blocks",
        "from_port",
        "to_port",
        "ip_protocol",
        "protocol",
        "publicly_accessible",
    },
    "s3_public": {
        "acl",
        "policy",
        "block_public_acls",
        "block_public_policy",
        "ignore_public_acls",
        "restrict_public_buckets",
    },
    "encryption": {"storage_encrypted", "encrypted", "kms_key_id", "rule"},
    "recovery": {
        "backup_retention_period",
        "deletion_protection",
        "skip_final_snapshot",
        "multi_az",
    },
    "destruction": {"actions"},
}


def controls_for(resource: dict, attribute: str | None = None) -> set[str]:
    change = resource["change"]
    unknown = change.get("after_unknown", {})
    keys = (
        {attribute}
        if attribute
        else set(change.get("before") or {}) | set(change.get("after") or {})
    )
    if attribute is None and isinstance(unknown, dict):
        keys |= set(unknown)
    if "delete" in change["actions"] and attribute is None:
        keys.add("actions")
    kind = resource["type"]
    controls = {control for control, attrs in CONTROLS.items() if attrs & keys}
    if not kind.startswith("aws_iam_"):
        controls -= {"iam_permissions", "iam_trust"}
    if not kind.startswith("aws_s3_"):
        controls.discard("s3_public")
    return controls


def load_corpus(path: Path = CORPUS) -> list[dict]:
    if path.stat().st_size > 128_000:
        raise ValueError("Evidence corpus exceeds its size budget")
    items = json.loads(path.read_text())["items"]
    if not isinstance(items, list) or len(items) > 30:
        raise ValueError("Evidence corpus item limit exceeded")
    ids = [item["id"] for item in items]
    if len(ids) != len(set(ids)):
        raise ValueError("Duplicate evidence IDs")
    for item in items:
        if not re.fullmatch(r"[A-Z][A-Z0-9-]{2,80}", item["id"]):
            raise ValueError("Invalid evidence ID")
        if not item["url"].startswith(
            ("https://docs.aws.amazon.com/", "https://github.com/manynames3/terragate/")
        ):
            raise ValueError("Unapproved evidence source")
        date.fromisoformat(item["updated_at"])
        date.fromisoformat(item["retrieved_at"])
        if (
            not isinstance(item["passage"], str)
            or len(item["passage"]) > 2000
            or not isinstance(item["title"], str)
            or len(item["title"]) > 300
        ):
            raise ValueError("Invalid evidence passage/title")
        if (
            not isinstance(item["resource_types"], list)
            or not isinstance(item["controls"], list)
            or not set(item["controls"]) <= CONTROLS.keys()
        ):
            raise ValueError("Invalid evidence scope")
        if re.search(r"[\s<>()]", item["url"]) or len(item["url"]) > 600:
            raise ValueError("Invalid evidence URL")
    return items


def retrieve(
    resource: dict, *, items: list[dict] | None = None, today: date | None = None
) -> dict:
    today = today or date.today()
    controls = controls_for(resource)
    selected, warnings = [], []
    for item in items if items is not None else load_corpus():
        if resource["type"] not in item["resource_types"] or not controls.intersection(
            item["controls"]
        ):
            continue
        if INSTRUCTION.search(item["title"] + " " + item["passage"]):
            warnings.append(f"quarantined:{item['id']}")
            continue
        age = (today - date.fromisoformat(item["updated_at"])).days
        if age < 0 or age > 180 or item.get("status", "active") != "active":
            warnings.append(f"stale_or_conflicting:{item['id']}")
            continue
        selected.append(item)
    selected.sort(key=lambda item: item["id"])
    return {"items": selected[:8], "warnings": warnings, "truncated": len(selected) > 8}
