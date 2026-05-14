import httpx
import pytest

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
