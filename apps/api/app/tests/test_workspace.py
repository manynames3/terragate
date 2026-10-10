from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.tests.test_api import ROOT, setup_module as reset_database
from app.auth.dev import DevUser, get_current_user, enforce_membership
from app.db.session import SessionLocal
from app.main import app
from app.models import MembershipModel, RunModel, RiskExceptionModel, ArtifactModel


def setup_module():
    reset_database()


@pytest.fixture
def client():
    app.dependency_overrides[get_current_user] = lambda: DevUser(id="requester", email="requester@example.test", role="reviewer", org_id="workspace-a")
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def identity(role="platform-admin", org="workspace-a", subject="approver"):
    app.dependency_overrides[get_current_user] = lambda: DevUser(id=subject, email=f"{subject}@example.test", role=role, org_id=org)


def create(client, fixture="risky-security-plan.json"):
    r = client.post("/api/v1/terraform-reviews/json", json={"file_name": fixture, "plan_json_text": (ROOT / "sample-data/terraform-plans" / fixture).read_text()})
    assert r.status_code == 200, r.text
    return r.json()["run_id"]


def request(client, run_id, **changes):
    report = client.get(f"/api/v1/runs/{run_id}/report").json()
    findings = client.get(f"/api/v1/runs/{run_id}/findings").json()
    payload = {"finding_id": findings[0]["id"], "review_snapshot_hash": report["review_snapshot_hash"],
        "justification": "Temporary access during migration with documented compensating controls.",
        "expires_at": (datetime.now(timezone.utc)+timedelta(days=7)).isoformat(), **changes}
    return client.post(f"/api/v1/runs/{run_id}/exceptions", json=payload)


def test_unassessed_is_not_zero_and_failure_not_low(client):
    run_id = create(client, "safe-plan.json")
    assert client.get(f"/api/v1/runs/{run_id}").json()["risk_score"] == 0
    with SessionLocal() as db:
        run = db.get(RunModel, run_id)
        run.status, run.completed_at, run.risk_score_detail = "queued", None, {}
        db.commit()
    run = client.get(f"/api/v1/runs/{run_id}").json()
    assert run["risk_score"] is None and run["policy_decision"] == "not_assessed"
    assert client.get(f"/api/v1/runs/{run_id}/report").json()["risk_score"] is None
    with SessionLocal() as db:
        db.get(RunModel, run_id).status = "failed"
        db.commit()
    assert client.get(f"/api/v1/runs/{run_id}").json()["policy_decision"] == "unavailable"


def test_queue_filters_search_pagination_and_authorization(client):
    run_id = create(client)
    assert client.get("/api/v1/reviews?q=Public&limit=1").json()["total"] >= 1
    assert client.get("/api/v1/reviews?q=internet&limit=1").json()["total"] >= 1
    first = client.get("/api/v1/reviews?status=all&limit=1").json()
    assert len(first["items"]) == 1
    assert first["items"][0]["policy_decision"] == "blocked"
    assert client.get("/api/v1/reviews?environment=missing").json()["total"] == 0
    assert client.get("/api/v1/reviews?offset=9999").json()["items"] == []
    assert client.get("/api/v1/reviews?limit=1000").status_code == 422
    identity(org="workspace-b")
    for endpoint in ["", "/report", "/findings", "/plan"]:
        assert client.get(f"/api/v1/runs/{run_id}{endpoint}").status_code == 404
    assert client.get("/api/v1/reviews").json()["total"] == 0
    assert client.get("/api/v1/audit-log").json()["total"] == 0


def test_queue_queries_are_batched_and_comment_approval_does_not_clear_risk(client):
    from sqlalchemy import event
    from app.db.session import engine
    ids = [create(client) for _ in range(3)]
    with SessionLocal() as db:
        run = db.get(RunModel, ids[0])
        run.status, run.approval_status = "approved", "approved"
        db.commit()
    statements = []
    def count_sql(_, __, statement, ___, ____, _____):
        statements.append(statement)
    event.listen(engine, "before_cursor_execute", count_sql)
    try:
        page = client.get("/api/v1/reviews?status=attention&limit=100").json()
    finally:
        event.remove(engine, "before_cursor_execute", count_sql)
    assert any(run["id"] == ids[0] and run["policy_decision"] == "blocked" for run in page["items"])
    assert len(statements) <= 13


def test_exception_lifecycle_no_self_approval_and_comment_separation(client):
    run_id = create(client)
    before = client.get(f"/api/v1/runs/{run_id}").json()
    response = request(client, run_id)
    assert response.status_code == 200, response.text
    item = response.json()
    assert item["finding_title"] and item["resource_address"]
    scoped = client.get(f"/api/v1/exceptions?run_id={run_id}&finding_id={item['finding_id']}").json()
    assert scoped["total"] == 1
    assert client.get(f"/api/v1/exceptions?run_id={run_id}&finding_id=other-finding").json()["total"] == 0
    assert request(client, run_id).status_code == 409
    identity(subject="requester")
    assert client.post(f"/api/v1/exceptions/{item['id']}/decision", json={"decision":"approved","notes":"Verified compensating controls"}).status_code == 403
    identity()
    assert client.post(f"/api/v1/exceptions/{item['id']}/decision", json={"decision":"approved","notes":"Verified compensating controls"}).status_code == 200
    after = client.get(f"/api/v1/runs/{run_id}").json()
    assert after["risk_score"] == before["risk_score"]
    assert after["blocking_findings"] == before["blocking_findings"]-1
    assert after["accepted_findings"] == 1
    assert client.post(f"/api/v1/runs/{run_id}/github-comment").status_code == 409
    assert client.post(f"/api/v1/exceptions/{item['id']}/decision", json={"decision":"revoked","notes":"Compensating control removed"}).status_code == 200
    assert client.get(f"/api/v1/runs/{run_id}").json()["blocking_findings"] == before["blocking_findings"]
    actions = [e["action"] for e in client.get("/api/v1/audit-log").json()["items"]]
    assert {"exception.requested", "exception.approved", "exception.revoked"} <= set(actions)


@pytest.mark.parametrize("changes", [
    {"justification":" "*25}, {"expires_at":"2020-01-01T00:00:00Z"},
    {"expires_at":"2099-01-01T00:00:00Z"}, {"expires_at":"2030-01-01T00:00:00"},
    {"review_snapshot_hash":"0"*64}, {"finding_id":"other-organization-finding"}])
def test_exception_validation(client, changes):
    r = request(client, create(client), **changes)
    assert r.status_code in {404,409,422}


def test_exception_expiry_staleness_and_cross_org_decision(client):
    run_id = create(client)
    item = request(client, run_id).json()
    identity(org="workspace-b")
    assert client.post(f"/api/v1/exceptions/{item['id']}/decision", json={"decision":"approved","notes":"Should not be authorized"}).status_code == 404
    assert client.get("/api/v1/exceptions").json()["total"] == 0
    identity()
    with SessionLocal() as db:
        db.get(RunModel, run_id).reviewed_head_sha = "a"*40
        db.commit()
    assert client.post(f"/api/v1/exceptions/{item['id']}/decision", json={"decision":"approved","notes":"Stale revision cannot pass"}).status_code == 409
    assert any(e["id"]==item["id"] and e["status"]=="stale" for e in client.get("/api/v1/exceptions").json()["items"])
    with SessionLocal() as db:
        db.get(RiskExceptionModel,item["id"]).expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
        db.commit()
    assert any(e["id"]==item["id"] and e["status"]=="expired" for e in client.get("/api/v1/exceptions").json()["items"])


def test_plan_endpoint_only_redacted_and_integrity_checked(client):
    run_id = create(client)
    plan = client.get(f"/api/v1/runs/{run_id}/plan").json()
    assert plan["redacted"] and plan["total"] > 0
    assert "[REDACTED]" in str(plan)
    assert client.get(f"/api/v1/runs/{run_id}/plan?resource=no-such-resource").json()["total"] == 0
    with SessionLocal() as db:
        artifact = db.scalar(select(ArtifactModel).where(ArtifactModel.run_id==run_id,ArtifactModel.type=="terraform_plan_redacted"))
        Path(artifact.storage_uri).write_text("{}")
    assert client.get(f"/api/v1/runs/{run_id}/plan").status_code == 409


def test_uploaded_name_cannot_overwrite_generated_artifact(client):
    response = client.post("/api/v1/terraform-reviews/json", json={"file_name":"tfplan.redacted.json", "plan_json_text":(ROOT / "sample-data/terraform-plans/risky-security-plan.json").read_text()})
    assert response.status_code == 200
    run_id = response.json()["run_id"]
    with SessionLocal() as db:
        artifacts = db.scalars(select(ArtifactModel).where(ArtifactModel.run_id == run_id)).all()
        raw = next(a for a in artifacts if a.type == "terraform_plan_raw")
        redacted = next(a for a in artifacts if a.type == "terraform_plan_redacted")
        assert raw.storage_uri != redacted.storage_uri
        from hashlib import sha256
        assert sha256(Path(raw.storage_uri).read_bytes()).hexdigest() == raw.sha256
    assert client.get(f"/api/v1/runs/{run_id}").json()["terraform_execution"]["source_filename"] == "tfplan.redacted.json"


def test_worker_preflight_failure_does_not_leave_run_running(client, monkeypatch):
    from app.config import get_settings
    from app.models import ReviewJobModel
    from app.routes.terraform_reviews import _execute_review_job
    monkeypatch.setattr(get_settings(), "review_execution_mode", "worker")
    run_id = create(client)
    with SessionLocal() as db:
        artifact = db.scalar(select(ArtifactModel).where(ArtifactModel.run_id == run_id, ArtifactModel.type == "terraform_plan_raw"))
        Path(artifact.storage_uri).write_text("{}")
        job = db.scalar(select(ReviewJobModel).where(ReviewJobModel.run_id == run_id))
        payload = job.payload
    _execute_review_job(run_id, payload)
    run = client.get(f"/api/v1/runs/{run_id}").json()
    assert run["status"] == "failed" and run["risk_score"] is None
    assert run["job"]["status"] == "failed"


def test_check_api_failure_does_not_destroy_completed_assessment(client, monkeypatch):
    from app.config import get_settings
    from app.integrations.github import GitHubClient
    async def unavailable(*args, **kwargs):
        raise RuntimeError("sensitive upstream details")
    monkeypatch.setattr(get_settings(), "public_demo_mode", False)
    monkeypatch.setattr(GitHubClient, "create_check_run", unavailable)
    run_id = create(client, "safe-plan.json")
    run = client.get(f"/api/v1/runs/{run_id}").json()
    assert run["assessment_state"] == "assessed" and run["risk_score"] == 0
    assert run["github_check"]["check_url"] is None
    assert "sensitive upstream details" not in str(run)
    events = client.get(f"/api/v1/runs/{run_id}/audit-log").json()
    assert any(e["action"] == "github.check_failed" for e in events)


def test_readiness_and_trace_ids(client):
    response = client.get("/ready")
    assert response.status_code == 200 and len(response.headers["X-Request-ID"]) == 32
    with patch("app.main.engine.connect", side_effect=RuntimeError("private database details")):
        response = client.get("/ready")
    assert response.status_code == 503
    assert "private database details" not in response.text


def test_membership_does_not_trust_role_claims(client):
    with pytest.raises(HTTPException) as e:
        enforce_membership(DevUser(id="member",org_id="workspace-a",role="platform-admin",auth_provider="cognito"))
    assert e.value.status_code == 403
    with SessionLocal() as db:
        db.add(MembershipModel(subject_id="member",org_id="workspace-a",role="viewer",active=True))
        db.commit()
    user = enforce_membership(DevUser(id="member",org_id="workspace-a",role="platform-admin",auth_provider="cognito"))
    assert user.role == "viewer"
    with pytest.raises(HTTPException):
        enforce_membership(DevUser(id="member",org_id="workspace-b",auth_provider="cognito"))


def test_org_admin_cannot_edit_global_policy_files(client):
    app.dependency_overrides[get_current_user] = lambda: DevUser(id="private-admin", role="platform-admin", org_id="workspace-a", auth_provider="cognito")
    response = client.put("/api/v1/policy-packs/default", json={"max_monthly_delta":1})
    assert response.status_code == 403 and "operator configuration" in response.json()["detail"]
