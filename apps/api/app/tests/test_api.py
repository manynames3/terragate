import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_terragate_api.db"
os.environ["ARTIFACT_STORAGE_DIR"] = "./test_artifacts"
os.environ["GITHUB_TOKEN"] = ""

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import MetaData  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db.init_db import init_db  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402


ROOT = Path(__file__).resolve().parents[4]


def setup_module() -> None:
    metadata = MetaData()
    metadata.reflect(bind=engine)
    metadata.drop_all(bind=engine)
    init_db()


def test_auth_me_uses_dev_header_identity() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/auth/me",
            headers={
                "X-TerraGate-User-Email": "reviewer@example.com",
                "X-TerraGate-User-Name": "Review Lead",
                "X-TerraGate-Role": "reviewer",
            },
        )

    assert response.status_code == 200
    assert response.json() == {
        "id": "reviewer@example.com",
        "email": "reviewer@example.com",
        "name": "Review Lead",
        "role": "reviewer",
        "org_id": "dev",
        "groups": ["reviewer"],
        "auth_provider": "dev",
    }


def test_review_creation_is_role_gated() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/terraform-reviews",
            headers={"X-TerraGate-Role": "viewer"},
            data={"environment": "dev", "cloud_provider": "aws"},
        )

    assert response.status_code == 403


def test_create_review_requires_approval_before_github_post() -> None:
    plan_path = ROOT / "sample-data" / "terraform-plans" / "risky-security-plan.json"
    with TestClient(app) as client:
        with plan_path.open("rb") as file:
            response = client.post(
                "/api/v1/terraform-reviews",
                files={"file": ("risky-security-plan.json", file, "application/json")},
                data={
                    "environment": "prod",
                    "cloud_provider": "aws",
                    "repo_owner": "example",
                    "repo_name": "infra",
                    "pull_number": "42",
                    "policy_profile": "default",
                },
            )

        assert response.status_code == 200, response.text
        run_id = response.json()["run_id"]

        run = client.get(f"/api/v1/runs/{run_id}")
        assert run.status_code == 200
        assert run.json()["github_pr_context"]["mock"] is True
        assert "GITHUB_TOKEN" in run.json()["github_pr_context"]["message"]
        assert run.json()["job"]["status"] == "completed"
        assert run.json()["github_check"]["status"] == "completed"
        assert run.json()["audit_event_count"] >= 3

        blocked = client.post(f"/api/v1/runs/{run_id}/github-comment")
        assert blocked.status_code == 409

        approved = client.post(f"/api/v1/runs/{run_id}/approve", json={"notes": "demo approved"})
        assert approved.status_code == 200

        posted = client.post(f"/api/v1/runs/{run_id}/github-comment")
        assert posted.status_code == 200
        assert posted.json()["mock"] is True
        assert "GITHUB_TOKEN" in posted.json()["message"]

        patches = client.get(f"/api/v1/runs/{run_id}/fix-patches")
        assert patches.status_code == 200
        assert patches.json()
        patch_id = patches.json()[0]["id"]

        blocked_patch_commit = client.post(f"/api/v1/runs/{run_id}/fix-patches/{patch_id}/github-commit")
        assert blocked_patch_commit.status_code == 409

        patch_approval = client.post(f"/api/v1/runs/{run_id}/fix-patches/{patch_id}/approve")
        assert patch_approval.status_code == 200
        assert patch_approval.json()["status"] == "approved"

        patch_commit = client.post(f"/api/v1/runs/{run_id}/fix-patches/{patch_id}/github-commit")
        assert patch_commit.status_code == 200
        assert patch_commit.json()["mock"] is True
        assert "GITHUB_TOKEN" in patch_commit.json()["message"]

        audit = client.get(f"/api/v1/runs/{run_id}/audit-log")
        assert audit.status_code == 200
        assert any(entry["action"] == "approval.approved" for entry in audit.json())
        assert any(entry["action"] == "fix_patch.commit_mocked" for entry in audit.json())


def test_pr_context_preview_returns_clear_dev_placeholder_without_token() -> None:
    with TestClient(app) as client:
        response = client.get(
            "/api/v1/github/pr-context",
            params={"repo_owner": "example", "repo_name": "infra", "pull_number": "42"},
        )

    assert response.status_code == 200
    payload = response.json()
    assert payload["available"] is False
    assert payload["mock"] is True
    assert payload["repo_full_name"] == "example/infra"


def test_sandbox_execution_is_explicitly_opt_in() -> None:
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/terraform-reviews",
            data={
                "execution_mode": "sandbox_plan",
                "terraform_working_dir": "demo-infra",
            },
        )

    assert response.status_code == 400
    assert "TERRAFORM_SANDBOX_ENABLED" in response.json()["detail"]


def test_github_webhook_requires_plan_execution_configuration() -> None:
    payload = {
        "action": "opened",
        "repository": {
            "name": "infra",
            "full_name": "example/infra",
            "owner": {"login": "example"},
        },
        "pull_request": {
            "number": 42,
            "head": {"sha": "abc123"},
        },
    }
    with TestClient(app) as client:
        response = client.post(
            "/api/v1/github/webhook",
            headers={"X-GitHub-Event": "pull_request"},
            json=payload,
        )

    assert response.status_code == 202
    assert response.json()["accepted"] is False
    assert "GITHUB_WEBHOOK_TERRAFORM_WORKING_DIR" in response.json()["reason"]


def test_policy_pack_update_is_role_gated() -> None:
    with TestClient(app) as client:
        blocked = client.put(
            "/api/v1/policy-packs/default",
            headers={"X-TerraGate-Role": "viewer"},
            json={"max_monthly_delta": 900},
        )
        allowed = client.get("/api/v1/policy-packs/default")

    assert blocked.status_code == 403
    assert allowed.status_code == 200
    assert allowed.json()["name"] == "default"


def test_demo_sample_review_runs_without_upload_or_auth_headers() -> None:
    os.environ["PUBLIC_DEMO_MODE"] = "true"
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            response = client.post("/api/v1/demo/terraform-reviews", json={"sample": "risky-cost"})

            assert response.status_code == 200, response.text
            run_id = response.json()["run_id"]
            run = client.get(f"/api/v1/runs/{run_id}")

        assert run.status_code == 200
        payload = run.json()
        assert payload["terraform_execution"]["mode"] == "demo_sample"
        assert payload["terraform_execution"]["sample"] == "risky-cost"
        assert payload["job"]["status"] == "completed"
        assert payload["risk_score"] > 0
    finally:
        os.environ.pop("PUBLIC_DEMO_MODE", None)
        get_settings.cache_clear()


def test_json_upload_review_runs_in_public_demo_mode() -> None:
    plan_path = ROOT / "sample-data" / "terraform-plans" / "risky-security-plan.json"
    os.environ["PUBLIC_DEMO_MODE"] = "true"
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/terraform-reviews/json",
                json={
                    "file_name": "risky-security-plan.json",
                    "plan_json_text": plan_path.read_text(),
                    "environment": "prod",
                    "cloud_provider": "aws",
                    "policy_profile": "default",
                },
            )
            assert response.status_code == 200, response.text
            run_id = response.json()["run_id"]
            run = client.get(f"/api/v1/runs/{run_id}")

        assert run.status_code == 200
        payload = run.json()
        assert payload["terraform_execution"]["mode"] == "uploaded_plan"
        assert payload["job"]["status"] == "completed"
        assert payload["risk_score"] > 0
    finally:
        os.environ.pop("PUBLIC_DEMO_MODE", None)
        get_settings.cache_clear()


def test_public_demo_upload_limit_rejects_large_plans() -> None:
    plan_path = ROOT / "sample-data" / "terraform-plans" / "safe-plan.json"
    os.environ["PUBLIC_DEMO_MODE"] = "true"
    os.environ["PUBLIC_DEMO_MAX_UPLOAD_BYTES"] = "10"
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            with plan_path.open("rb") as file:
                response = client.post(
                    "/api/v1/terraform-reviews",
                    files={"file": ("safe-plan.json", file, "application/json")},
                    data={"environment": "dev", "cloud_provider": "aws"},
                )

        assert response.status_code == 413
        assert "Public demo uploads are limited" in response.json()["detail"]
    finally:
        os.environ.pop("PUBLIC_DEMO_MODE", None)
        os.environ.pop("PUBLIC_DEMO_MAX_UPLOAD_BYTES", None)
        get_settings.cache_clear()


def test_public_demo_json_upload_limit_rejects_large_plans() -> None:
    plan_path = ROOT / "sample-data" / "terraform-plans" / "safe-plan.json"
    os.environ["PUBLIC_DEMO_MODE"] = "true"
    os.environ["PUBLIC_DEMO_MAX_UPLOAD_BYTES"] = "10"
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            response = client.post(
                "/api/v1/terraform-reviews/json",
                json={
                    "file_name": "safe-plan.json",
                    "plan_json_text": plan_path.read_text(),
                    "environment": "dev",
                    "cloud_provider": "aws",
                },
            )

        assert response.status_code == 413
        assert "Public demo uploads are limited" in response.json()["detail"]
    finally:
        os.environ.pop("PUBLIC_DEMO_MODE", None)
        os.environ.pop("PUBLIC_DEMO_MAX_UPLOAD_BYTES", None)
        get_settings.cache_clear()


def test_public_demo_policy_packs_are_read_only() -> None:
    os.environ["PUBLIC_DEMO_MODE"] = "true"
    get_settings.cache_clear()
    try:
        with TestClient(app) as client:
            response = client.put(
                "/api/v1/policy-packs/default",
                json={"max_monthly_delta": 900},
            )

        assert response.status_code == 403
        assert "read-only in public demo mode" in response.json()["detail"]
    finally:
        os.environ.pop("PUBLIC_DEMO_MODE", None)
        get_settings.cache_clear()
