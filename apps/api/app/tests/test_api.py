import os
from pathlib import Path

os.environ["DATABASE_URL"] = "sqlite:///./test_cloudops_api.db"
os.environ["ARTIFACT_STORAGE_DIR"] = "./test_artifacts"

from fastapi.testclient import TestClient  # noqa: E402

from app.db.init_db import init_db  # noqa: E402
from app.db.session import Base, engine  # noqa: E402
from app.main import app  # noqa: E402


ROOT = Path(__file__).resolve().parents[4]


def setup_module() -> None:
    Base.metadata.drop_all(bind=engine)
    init_db()


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

        blocked = client.post(f"/api/v1/runs/{run_id}/github-comment")
        assert blocked.status_code == 409

        approved = client.post(f"/api/v1/runs/{run_id}/approve", json={"notes": "demo approved"})
        assert approved.status_code == 200

        posted = client.post(f"/api/v1/runs/{run_id}/github-comment")
        assert posted.status_code == 200
        assert posted.json()["mock"] is True
        assert "GITHUB_TOKEN" in posted.json()["message"]
