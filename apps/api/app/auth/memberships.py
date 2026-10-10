"""Operator-only membership provisioning; never exposed as a public endpoint."""
import argparse

from sqlalchemy import select

from app.auth.dev import VALID_ROLES
from app.db.session import SessionLocal
from app.models import AuditLogModel, MembershipModel


def set_membership(db, *, subject: str, organization: str, role: str, active: bool, actor: str):
    if not subject.strip() or len(subject) > 255 or not organization.strip() or len(organization) > 120:
        raise ValueError("Provide a subject (1-255 characters) and organization (1-120 characters).")
    if role not in VALID_ROLES or not actor.strip() or len(actor) > 255:
        raise ValueError("Provide a supported role and an attributed operator identity.")
    item = db.scalar(select(MembershipModel).where(
        MembershipModel.subject_id == subject, MembershipModel.org_id == organization).with_for_update())
    if not item:
        item = MembershipModel(subject_id=subject, org_id=organization, role=role, active=active)
        db.add(item)
    else:
        item.role, item.active = role, active
    db.flush()
    db.add(AuditLogModel(action="membership.granted" if active else "membership.revoked",
        actor_id=actor, actor_email=actor, target_type="membership", target_id=item.id,
        metadata_json={"subject": subject, "organization": organization, "role": role}))
    db.commit()
    return item


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["grant", "revoke"])
    parser.add_argument("--subject", required=True, help="Verified Cognito sub, not email")
    parser.add_argument("--organization", required=True, help="Exact signed organization claim")
    parser.add_argument("--role", required=True, choices=sorted(VALID_ROLES))
    parser.add_argument("--actor", required=True, help="Operator identity for the audit record")
    args = parser.parse_args()
    with SessionLocal() as db:
        set_membership(db, subject=args.subject, organization=args.organization,
                       role=args.role, active=args.action == "grant", actor=args.actor)
    print(f"Membership {args.action} recorded for {args.organization}.")


if __name__ == "__main__":
    main()
