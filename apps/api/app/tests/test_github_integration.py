import httpx
import pytest
import base64

from app.integrations import github

from app.integrations.github import GitHubClient


@pytest.mark.asyncio
async def test_fetch_pr_context_collects_metadata_and_terraform_files() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/repos/acme/infra/pulls/7":
            return httpx.Response(
                200,
                json={
                    "title": "Add production database",
                    "state": "open",
                    "draft": False,
                    "html_url": "https://github.com/acme/infra/pull/7",
                    "changed_files": 2,
                    "additions": 22,
                    "deletions": 3,
                    "user": {"login": "octocat"},
                    "base": {"ref": "main"},
                    "head": {"ref": "feature/db", "sha": "abc123"},
                    "labels": [{"name": "terraform"}],
                    "requested_reviewers": [{"login": "platform"}],
                },
            )
        if request.url.path == "/repos/acme/infra/pulls/7/files":
            return httpx.Response(
                200,
                json=[
                    {
                        "filename": "infra/rds.tf",
                        "status": "modified",
                        "additions": 20,
                        "deletions": 2,
                        "changes": 22,
                        "patch": '@@ terraform patch\n+  password = "super-secret"',
                        "blob_url": "https://github.com/acme/infra/blob/abc/infra/rds.tf",
                    },
                    {
                        "filename": "README.md",
                        "status": "modified",
                        "additions": 2,
                        "deletions": 1,
                        "changes": 3,
                    },
                ],
            )
        return httpx.Response(404, json={"message": "not found"})

    context = await GitHubClient(
        "token",
        base_url="https://api.github.test",
        transport=httpx.MockTransport(handler),
    ).fetch_pr_context("acme", "infra", 7)

    assert context.available is True
    assert context.mock is False
    assert context.title == "Add production database"
    assert context.author == "octocat"
    assert context.changed_files_count == 2
    assert [file.filename for file in context.terraform_files] == ["infra/rds.tf"]
    assert "super-secret" not in (context.terraform_files[0].patch or "")
    assert "[REDACTED]" in (context.terraform_files[0].patch or "")


@pytest.mark.asyncio
async def test_fetch_pr_context_without_token_returns_dev_placeholder() -> None:
    context = await GitHubClient(None).fetch_pr_context("acme", "infra", 7)

    assert context.available is False
    assert context.mock is True
    assert context.repo_full_name == "acme/infra"
    assert "GITHUB_TOKEN" in context.message


@pytest.mark.asyncio
async def test_patch_requires_immutable_reviewed_head_before_any_github_request() -> None:
    def handler(request):
        pytest.fail("Unreviewed patches must not contact GitHub")

    result = await GitHubClient("token", transport=httpx.MockTransport(handler)).commit_patch_to_pr_branch(
        "acme", "infra", 7, "main.tf", "@@\n+unsafe", commit_message="fix",
    )
    assert result.committed is False
    assert result.mock is False


@pytest.mark.asyncio
@pytest.mark.parametrize("ref_status", [200, 422])
async def test_patch_commit_is_pinned_and_uses_non_force_atomic_branch_update(monkeypatch, ref_status) -> None:
    import json

    requests = []
    head_sha = "a" * 40
    updated = 'variable "retention" {\n  default = 7\n}\n'
    monkeypatch.setattr(github, "apply_reviewed_patch", lambda original, diff, path: updated)

    def handler(request):
        requests.append(request)
        path = request.url.path
        if path.endswith("/pulls/7"):
            return httpx.Response(200, json={"state": "open", "head": {"ref": "feature/db", "sha": head_sha, "repo": {"full_name": "acme/infra"}}})
        if path.endswith("/contents/main.tf"):
            assert request.url.params["ref"] == head_sha
            return httpx.Response(200, json={"sha": "old_blob", "content": base64.b64encode(b"original").decode()})
        if path.endswith(f"/git/commits/{head_sha}"):
            return httpx.Response(200, json={"tree": {"sha": "old_tree"}})
        if path.endswith("/git/blobs"):
            assert json.loads(request.content)["content"] == updated
            return httpx.Response(201, json={"sha": "new_blob"})
        if path.endswith("/git/trees"):
            assert json.loads(request.content)["base_tree"] == "old_tree"
            return httpx.Response(201, json={"sha": "new_tree"})
        if path.endswith("/git/commits"):
            assert json.loads(request.content)["parents"] == [head_sha]
            return httpx.Response(201, json={"sha": "new_commit", "html_url": "https://github.test/commit/1"})
        if path.endswith("/git/refs/heads/feature/db"):
            assert request.method == "PATCH"
            assert json.loads(request.content) == {"sha": "new_commit", "force": False}
            return httpx.Response(ref_status, json={"message": "Head changed"})
        pytest.fail(f"Unexpected request: {request.method} {path}")

    result = await GitHubClient("token", base_url="https://api.github.test", transport=httpx.MockTransport(handler)).commit_patch_to_pr_branch(
        "acme", "infra", 7, "main.tf", "reviewed diff", commit_message="fix", expected_head_sha=head_sha,
    )
    assert result.committed is (ref_status == 200)
    assert not any(request.method == "PUT" for request in requests)


@pytest.mark.asyncio
async def test_stale_pr_head_blocks_patch_before_content_or_writes() -> None:
    def handler(request):
        assert request.method == "GET" and request.url.path.endswith("/pulls/7")
        return httpx.Response(200, json={"state": "open", "head": {"sha": "b" * 40, "ref": "feature"}})

    result = await GitHubClient("token", transport=httpx.MockTransport(handler)).commit_patch_to_pr_branch(
        "acme", "infra", 7, "main.tf", "diff", commit_message="fix", expected_head_sha="a" * 40,
    )
    assert result.committed is False
    assert "head changed" in result.message


@pytest.mark.asyncio
async def test_live_pr_verification_rejects_missing_or_changed_reviewed_commit() -> None:
    def handler(request):
        return httpx.Response(200, json={"state": "open", "head": {"sha": "a" * 40}})

    client = GitHubClient("token", transport=httpx.MockTransport(handler))
    assert await client.verify_pr_head("acme", "infra", 7, "a" * 40) is None
    assert "head changed" in await client.verify_pr_head("acme", "infra", 7, "b" * 40)
    assert "No live PR commit" in await client.verify_pr_head("acme", "infra", 7, None)
