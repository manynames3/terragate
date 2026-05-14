from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from app.auth.dev import DevUser
from app.models import AuditLogModel


def record_audit(
    db: Session,
    *,
    action: str,
    run_id: str | None = None,
    actor: DevUser | None = None,
    target_type: str = "run",
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> AuditLogModel:
    entry = AuditLogModel(
        run_id=run_id,
        actor_id=actor.id if actor else None,
        actor_email=actor.email if actor else None,
        action=action,
        target_type=target_type,
        target_id=target_id or run_id,
        metadata_json=metadata or {},
    )
    db.add(entry)
    return entry
