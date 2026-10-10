import asyncio
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt.algorithms import RSAAlgorithm
from sqlalchemy import select

from app.auth import dev
from app.auth.memberships import set_membership
from app.config import Settings
from app.db.session import SessionLocal
from app.graph.terraform_review.nodes.policy_checks import run_policy_checks
from app.integrations.storage import FileSystemArtifactStore
from app.models import AuditLogModel, MembershipModel
from app.services.terraform_plan import TerraformPlanError, collect_sensitive_paths, extract_resource_changes, get_attr, redacted_plan_with_changes, validate_terraform_plan


def resource():
    return {"address":"aws_db_instance.main", "type":"aws_db_instance", "change":{
        "actions":["update"], "before":{"backup_retention_period":7, "publicly_accessible":False},
        "after":{"backup_retention_period":None, "publicly_accessible":True, "tags":{"owner":"team", "environment":"prod", "service":"db", "cost_center":"platform"}},
        "after_unknown":{"backup_retention_period":True}}}


def test_unknown_is_not_old_state_or_confirmed_failure():
    item = resource()
    assert get_attr(item, "backup_retention_period") is None
    findings = run_policy_checks([item], environment="prod", policy_profile="default")
    assert any(f["title"] == "RDS instance is publicly accessible" for f in findings)
    uncertain = next(f for f in findings if f["title"] == "Policy inputs require verification")
    assert uncertain["confidence"] == .5 and uncertain["requires_human_review"]
    assert not any(e["rule_id"] == "REL-RDS-002" for f in findings for e in f["evidence"])
    item["change"]["after_unknown"] = {}
    item["change"]["after"].pop("publicly_accessible")
    assert get_attr(item, "publicly_accessible") is None
    item["change"]["actions"] = ["delete"]
    assert get_attr(item, "backup_retention_period") == 7


def test_terraform_sensitive_masks_redact_innocently_named_values():
    item = resource()
    item["change"]["after"].update({"connection_string":"hidden connection", "nested":[{"value":"hidden array value"}]})
    item["change"]["after_sensitive"] = {"connection_string":True, "nested":[{"value":True}]}
    item["change"]["before_sensitive"] = {"backup_retention_period":True}
    plan = {"resource_changes":[item], "output_changes":{"endpoint":{"after":"hidden output", "after_sensitive":True}},
        "planned_values":{"outputs":{"url":{"value":"hidden output two", "sensitive":True}}}}
    redacted = redacted_plan_with_changes(plan)
    assert "hidden" not in json.dumps(redacted)
    assert "[REDACTED]" in json.dumps(redacted)
    assert any("connection_string" in path for path, _ in collect_sensitive_paths(plan))
    assert extract_resource_changes(redacted)[0]["change"]["after_unknown"]["backup_retention_period"] is True
    item["change"]["after_sensitive"] = True
    assert redacted_plan_with_changes({"resource_changes":[item]})["resource_changes"][0]["change"]["after"]["connection_string"] == "[REDACTED]"


@pytest.mark.parametrize("changes", [[None], [{"address":"x","type":"aws_instance","change":{"actions":"create"}}], [{"address":"x","type":"aws_instance","change":{"actions":["create"], "after":[]}}]])
def test_invalid_resource_structure_is_actionable(changes):
    with pytest.raises(TerraformPlanError, match="resource_changes"):
        validate_terraform_plan({"resource_changes":changes})


def test_artifacts_private_and_cannot_escape_store(tmp_path):
    store = FileSystemArtifactStore(tmp_path / "artifacts")
    uri, _ = store.write_json("run_test", "plan.json", {"safe":True})
    assert Path(uri).stat().st_mode & 0o777 == 0o600
    assert Path(uri).parent.stat().st_mode & 0o777 == 0o700
    with pytest.raises(ValueError):
        store.write_json("../../escape", "plan.json", {})
    target = tmp_path / "outside.json"
    target.write_text("unchanged")
    (Path(uri).parent / "link.json").symlink_to(target)
    with pytest.raises(ValueError):
        store.write_json("run_test", "link.json", {})
    assert target.read_text() == "unchanged"


def test_membership_operator_grant_revoke_attribution():
    with SessionLocal() as db:
        item = set_membership(db, subject="operator-test-subject", organization="operator-test-org", role="viewer", active=True, actor="operator@example.test")
        set_membership(db, subject=item.subject_id, organization=item.org_id, role="reviewer", active=False, actor="operator@example.test")
        assert not db.get(MembershipModel, item.id).active
        events = db.scalars(select(AuditLogModel).where(AuditLogModel.target_id == item.id)).all()
        assert {e.action for e in events} == {"membership.granted", "membership.revoked"}
        assert all(e.actor_id == "operator@example.test" for e in events)


@pytest.mark.parametrize("mutation", [{"client_id":"wrong-client"}, {"exp":None}, {"sub":None}, {"exp":datetime.now(timezone.utc)-timedelta(minutes=1)}, {"iss":"https://untrusted.example.test"}])
def test_signed_tokens_still_require_client_claims_and_expiry(monkeypatch, mutation):
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    jwk = json.loads(RSAAlgorithm.to_jwk(key.public_key()))
    settings = Settings(COGNITO_ISSUER="https://issuer.example.test", COGNITO_APP_CLIENT_ID="allowed-client")
    claims = {"iss":settings.resolved_cognito_issuer,"sub":"valid-sub", "client_id":"allowed-client", "token_use":"access", "exp":datetime.now(timezone.utc)+timedelta(minutes=5), **mutation}
    claims = {key:value for key,value in claims.items() if value is not None}
    token = jwt.encode(claims, key, algorithm="RS256", headers={"kid":"key"})
    async def signing_key(*_):
        return jwk
    monkeypatch.setattr(dev._jwks_cache, "key_for_kid", signing_key)
    with pytest.raises(HTTPException) as error:
        asyncio.run(dev._get_cognito_user(f"Bearer {token}", settings))
    assert error.value.status_code == 401


def test_private_production_cannot_use_dev_headers():
    with pytest.raises(HTTPException) as error:
        asyncio.run(dev.get_current_user(settings=Settings(APP_ENV="production", AUTH_MODE="dev", PUBLIC_DEMO_MODE=False)))
    assert error.value.status_code == 503


def test_webhooks_fail_closed_without_secret_and_reject_bad_signatures():
    from app.routes.terraform_reviews import _verify_github_signature
    import hashlib
    import hmac
    body = b'{"action":"opened"}'
    for signature, secret, expected in [(None,None,503), (None,"configured",401), ("sha256=invalid","configured",401)]:
        with pytest.raises(HTTPException) as error:
            _verify_github_signature(body,signature,secret)
        assert error.value.status_code == expected
    valid = "sha256=" + hmac.new(b"configured", body, hashlib.sha256).hexdigest()
    _verify_github_signature(body,valid,"configured")
    with pytest.raises(HTTPException):
        _verify_github_signature(body+b" ",valid,"configured")
