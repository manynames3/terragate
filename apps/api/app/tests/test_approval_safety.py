import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

# Reuse the existing isolated database and migration setup, not a live deployment.
from app.tests.test_api import ROOT, setup_module as reset_database
from app.db.session import SessionLocal
from app.main import app
from app.models import ApprovalModel, ArtifactModel, FixPatchModel, RunModel
from app.integrations.github import GitHubPostResult
from app.routes import terraform_reviews


def setup_module() -> None:
    reset_database()


def create_review(client: TestClient) -> str:
    response = client.post("/api/v1/terraform-reviews/json", json={
        "file_name": "safe-plan.json",
        "plan_json_text": (ROOT / "sample-data/terraform-plans/safe-plan.json").read_text(),
    })
    assert response.status_code == 200, response.text
    return response.json()["run_id"]


def report(client: TestClient, run_id: str) -> dict:
    response = client.get(f"/api/v1/runs/{run_id}/report")
    assert response.status_code == 200, response.text
    return response.json()


def approve(client: TestClient, run_id: str, draft: dict):
    return client.post(f"/api/v1/runs/{run_id}/approve", json={"notes": "Reviewed", "review_snapshot_hash": draft["review_snapshot_hash"]})


@pytest.mark.parametrize("status", ["queued", "running", "failed"])
def test_incomplete_reviews_cannot_receive_decisions(status: str) -> None:
    with TestClient(app) as client:
        run_id = create_review(client)
        with SessionLocal() as db:
            run = db.get(RunModel, run_id)
            run.status = status
            db.commit()
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 409
        assert client.post(f"/api/v1/runs/{run_id}/reject", json={"notes": "Not ready", "review_snapshot_hash": draft["review_snapshot_hash"]}).status_code == 409


def test_approval_requires_the_displayed_snapshot_and_records_actor() -> None:
    with TestClient(app) as client:
        run_id = create_review(client)
        draft = report(client, run_id)
        assert client.post(f"/api/v1/runs/{run_id}/approve", json={"notes": "No hash"}).status_code == 422
        assert approve(client, run_id, {**draft, "review_snapshot_hash": "0" * 64}).status_code == 409
        assert approve(client, run_id, draft).status_code == 200
        assert approve(client, run_id, draft).status_code == 200
        assert report(client, run_id)["approval_valid"] is True
        with SessionLocal() as db:
            decisions = db.scalars(select(ApprovalModel).where(ApprovalModel.run_id == run_id)).all()
            assert len(decisions) == 1
            assert decisions[0].snapshot_hash == draft["review_snapshot_hash"]
            assert decisions[0].actor_email


@pytest.mark.parametrize("field", ["draft", "artifact", "policy", "head", "score"])
def test_review_changes_invalidate_approval_and_block_posting(field: str) -> None:
    with TestClient(app) as client:
        run_id = create_review(client)
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 200
        with SessionLocal() as db:
            run = db.get(RunModel, run_id)
            if field == "draft":
                run.pr_comment_draft += "\nChanged after approval"
            elif field == "artifact":
                artifact = db.scalar(select(ArtifactModel).where(ArtifactModel.run_id == run_id))
                artifact.sha256 = "1" * 64
            elif field == "policy":
                run.policy_snapshot = {**run.policy_snapshot, "max_monthly_delta": 1}
            elif field == "head":
                run.reviewed_head_sha = "b" * 40
            else:
                run.risk_score = 99
            db.commit()
        assert report(client, run_id)["approval_valid"] is False
        assert client.post(f"/api/v1/runs/{run_id}/github-comment").status_code == 409
        assert approve(client, run_id, draft).status_code == 409


def test_post_uses_exact_displayed_draft_and_repeated_request_does_not_post_twice(monkeypatch) -> None:
    posted_bodies = []

    class GitHub:
        async def verify_pr_head(self, *args):
            return None

        async def post_pr_comment(self, owner, repo, number, body):
            posted_bodies.append(body)
            return GitHubPostResult(True, False, "Posted", "https://github.test/comment/1")

    with TestClient(app) as client:
        run_id = create_review(client)
        monkeypatch.setattr(terraform_reviews, "_github_client", lambda settings: GitHub())
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 200
        for _ in range(2):
            response = client.post(f"/api/v1/runs/{run_id}/github-comment")
            assert response.status_code == 200, response.text
            assert response.json()["comment_url"] == "https://github.test/comment/1"
        assert posted_bodies == [draft["pr_comment_draft"]]
        assert approve(client, run_id, draft).status_code == 409


def test_changed_live_pr_head_blocks_decisions_and_external_writes(monkeypatch) -> None:
    class GitHub:
        async def verify_pr_head(self, *args):
            return "The PR head changed. Run a new review."

        async def post_pr_comment(self, *args):
            pytest.fail("External write must not happen for a stale PR")

    with TestClient(app) as client:
        run_id = create_review(client)
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 200
        monkeypatch.setattr(terraform_reviews, "_github_client", lambda settings: GitHub())
        assert approve(client, run_id, draft).status_code == 409
        assert client.post(f"/api/v1/runs/{run_id}/github-comment").status_code == 409


def test_rejection_revokes_approval_and_requires_reason() -> None:
    with TestClient(app) as client:
        run_id = create_review(client)
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 200
        assert client.post(f"/api/v1/runs/{run_id}/reject", json={"review_snapshot_hash": draft["review_snapshot_hash"]}).status_code == 422
        response = client.post(f"/api/v1/runs/{run_id}/reject", json={"notes": "Backups unverified", "review_snapshot_hash": draft["review_snapshot_hash"]})
        assert response.status_code == 200
        assert report(client, run_id)["approval_valid"] is False
        assert client.post(f"/api/v1/runs/{run_id}/github-comment").status_code == 409


def test_changed_patch_cannot_use_old_patch_approval() -> None:
    with TestClient(app) as client:
        run_id = create_review(client)
        with SessionLocal() as db:
            patch = FixPatchModel(run_id=run_id, kind="patch", pr_file_path="main.tf", summary="Fix", diff="exact diff")
            db.add(patch)
            db.commit()
            patch_id = patch.id
        draft = report(client, run_id)
        assert approve(client, run_id, draft).status_code == 200
        patch = client.get(f"/api/v1/runs/{run_id}/fix-patches").json()[0]
        assert client.post(f"/api/v1/runs/{run_id}/fix-patches/{patch_id}/approve", json={"review_snapshot_hash": patch["review_snapshot_hash"]}).status_code == 200
        with SessionLocal() as db:
            db.get(FixPatchModel, patch_id).diff = "different diff"
            db.commit()
        assert client.post(f"/api/v1/runs/{run_id}/fix-patches/{patch_id}/github-commit").status_code == 409
