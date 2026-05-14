from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any


POLICY_PACK_DIR = Path(__file__).resolve().parents[1] / "policies" / "policy_packs"
POLICY_PACK_NAME_RE = re.compile(r"^[a-zA-Z0-9_-]{1,80}$")
EDITABLE_KEYS = {
    "description",
    "required_tags",
    "allowed_regions",
    "restricted_allowlist",
    "allowed_instance_families",
    "max_monthly_delta",
    "block_public_admin_ingress",
    "require_cost_center",
    "block_production_stateful_deletes",
    "require_deletion_protection_in_prod",
    "min_prod_backup_retention_days",
}


@dataclass(frozen=True)
class PolicyPack:
    name: str
    required_tags: set[str] = field(default_factory=lambda: {"owner", "environment", "service", "cost_center"})
    allowed_regions: set[str] = field(default_factory=lambda: {"us-east-1", "us-east-2", "us-west-2"})
    restricted_allowlist: set[str] = field(default_factory=set)
    allowed_instance_families: set[str] = field(default_factory=set)
    max_monthly_delta: float = 500.0
    block_public_admin_ingress: bool = True
    require_cost_center: bool = True
    block_production_stateful_deletes: bool = True
    require_deletion_protection_in_prod: bool = True
    min_prod_backup_retention_days: int = 7

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "required_tags": sorted(self.required_tags),
            "allowed_regions": sorted(self.allowed_regions),
            "restricted_allowlist": sorted(self.restricted_allowlist),
            "allowed_instance_families": sorted(self.allowed_instance_families),
            "max_monthly_delta": self.max_monthly_delta,
            "block_public_admin_ingress": self.block_public_admin_ingress,
            "require_cost_center": self.require_cost_center,
            "block_production_stateful_deletes": self.block_production_stateful_deletes,
            "require_deletion_protection_in_prod": self.require_deletion_protection_in_prod,
            "min_prod_backup_retention_days": self.min_prod_backup_retention_days,
        }


def load_policy_pack(name: str | None) -> PolicyPack:
    profile = (name or "default").strip() or "default"
    path = POLICY_PACK_DIR / f"{profile}.json"
    if not path.exists():
        path = POLICY_PACK_DIR / "default.json"
    payload = json.loads(path.read_text())
    return PolicyPack(
        name=payload.get("name", profile),
        required_tags=set(payload.get("required_tags", [])) or PolicyPack(profile).required_tags,
        allowed_regions=set(payload.get("allowed_regions", [])) or PolicyPack(profile).allowed_regions,
        restricted_allowlist=set(payload.get("restricted_allowlist", [])),
        allowed_instance_families=set(payload.get("allowed_instance_families", [])),
        max_monthly_delta=float(payload.get("max_monthly_delta", 500.0)),
        block_public_admin_ingress=bool(payload.get("block_public_admin_ingress", True)),
        require_cost_center=bool(payload.get("require_cost_center", True)),
        block_production_stateful_deletes=bool(payload.get("block_production_stateful_deletes", True)),
        require_deletion_protection_in_prod=bool(payload.get("require_deletion_protection_in_prod", True)),
        min_prod_backup_retention_days=int(payload.get("min_prod_backup_retention_days", 7)),
    )


def list_policy_packs() -> list[dict[str, Any]]:
    packs = []
    for path in sorted(POLICY_PACK_DIR.glob("*.json")):
        payload = json.loads(path.read_text())
        packs.append(
            {
                "name": payload.get("name", path.stem),
                "description": payload.get("description", ""),
                "max_monthly_delta": payload.get("max_monthly_delta", 0),
                "required_tags": payload.get("required_tags", []),
                "allowed_regions": payload.get("allowed_regions", []),
                "allowed_instance_families": payload.get("allowed_instance_families", []),
                "restricted_allowlist": payload.get("restricted_allowlist", []),
                "require_cost_center": payload.get("require_cost_center", True),
                "block_public_admin_ingress": payload.get("block_public_admin_ingress", True),
                "block_production_stateful_deletes": payload.get("block_production_stateful_deletes", True),
                "min_prod_backup_retention_days": payload.get("min_prod_backup_retention_days", 7),
            }
        )
    return packs


def get_policy_pack(name: str) -> dict[str, Any]:
    path = _policy_pack_path(name)
    if not path.exists():
        raise ValueError(f"Policy pack not found: {name}")
    payload = json.loads(path.read_text())
    policy = load_policy_pack(name).to_dict()
    policy["description"] = payload.get("description", "")
    return policy


def save_policy_pack(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    path = _policy_pack_path(name)
    current = get_policy_pack(name) if path.exists() else PolicyPack(name=name).to_dict() | {"description": ""}
    updated = {**current, **{key: value for key, value in payload.items() if key in EDITABLE_KEYS}}
    updated["name"] = name
    _validate_policy_pack(updated)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(updated, indent=2, sort_keys=False) + "\n")
    return get_policy_pack(name)


def _policy_pack_path(name: str) -> Path:
    if not POLICY_PACK_NAME_RE.match(name):
        raise ValueError("Policy pack names may only contain letters, numbers, underscores, and dashes.")
    return POLICY_PACK_DIR / f"{name}.json"


def _validate_policy_pack(payload: dict[str, Any]) -> None:
    list_fields = ["required_tags", "allowed_regions", "restricted_allowlist", "allowed_instance_families"]
    for field_name in list_fields:
        value = payload.get(field_name)
        if not isinstance(value, list) or not all(isinstance(item, str) and item.strip() for item in value):
            raise ValueError(f"{field_name} must be a list of non-empty strings.")
    for field_name in [
        "block_public_admin_ingress",
        "require_cost_center",
        "block_production_stateful_deletes",
        "require_deletion_protection_in_prod",
    ]:
        if not isinstance(payload.get(field_name), bool):
            raise ValueError(f"{field_name} must be a boolean.")
    if float(payload.get("max_monthly_delta", -1)) < 0:
        raise ValueError("max_monthly_delta must be zero or greater.")
    if int(payload.get("min_prod_backup_retention_days", -1)) < 0:
        raise ValueError("min_prod_backup_retention_days must be zero or greater.")
