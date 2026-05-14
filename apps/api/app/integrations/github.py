from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx


@dataclass
class GitHubPostResult:
    posted: bool
    mock: bool
    message: str
    comment_url: str | None = None


@dataclass
class GitHubPRFile:
    filename: str
    status: str
    additions: int
    deletions: int
    changes: int
    patch: str | None = None
    raw_url: str | None = None
    blob_url: str | None = None


@dataclass
class GitHubPRContext:
    available: bool
    mock: bool
    message: str
    repo_owner: str | None = None
    repo_name: str | None = None
    repo_full_name: str | None = None
    pull_number: int | None = None
    title: str | None = None
    state: str | None = None
    draft: bool | None = None
    author: str | None = None
    base_ref: str | None = None
    head_ref: str | None = None
    html_url: str | None = None
    latest_commit_sha: str | None = None
    changed_files_count: int = 0
    additions: int = 0
    deletions: int = 0
    labels: list[str] = field(default_factory=list)
    requested_reviewers: list[str] = field(default_factory=list)
    files: list[GitHubPRFile] = field(default_factory=list)
    terraform_files: list[GitHubPRFile] = field(default_factory=list)
    fetched_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> dict[str, Any]:
        return {
            "available": self.available,
            "mock": self.mock,
            "message": self.message,
            "repo_owner": self.repo_owner,
            "repo_name": self.repo_name,
            "repo_full_name": self.repo_full_name,
            "pull_number": self.pull_number,
            "title": self.title,
            "state": self.state,
            "draft": self.draft,
            "author": self.author,
            "base_ref": self.base_ref,
            "head_ref": self.head_ref,
            "html_url": self.html_url,
            "latest_commit_sha": self.latest_commit_sha,
            "changed_files_count": self.changed_files_count,
            "additions": self.additions,
            "deletions": self.deletions,
            "labels": self.labels,
            "requested_reviewers": self.requested_reviewers,
            "files": [file.__dict__ for file in self.files],
            "terraform_files": [file.__dict__ for file in self.terraform_files],
            "fetched_at": self.fetched_at,
        }


class GitHubClient:
    def __init__(
        self,
        token: str | None,
        *,
        base_url: str = "https://api.github.com",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.transport = transport

    async def fetch_pr_context(
        self,
        repo_owner: str | None,
        repo_name: str | None,
        pull_number: int | None,
    ) -> GitHubPRContext:
        if not repo_owner or not repo_name or not pull_number:
            return GitHubPRContext(
                available=False,
                mock=True,
                message="GitHub repo owner, repo name, and pull number are required.",
                repo_owner=repo_owner,
                repo_name=repo_name,
                pull_number=pull_number,
            )

        if not self.token:
            return GitHubPRContext(
                available=False,
                mock=True,
                message=(
                    "GITHUB_TOKEN is not configured. PR context will be stored as a "
                    "dev placeholder and comment posting will use the approval-gated mock path."
                ),
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_full_name=f"{repo_owner}/{repo_name}",
                pull_number=pull_number,
            )

        try:
            async with self._client() as client:
                pr_response = await client.get(
                    f"/repos/{repo_owner}/{repo_name}/pulls/{pull_number}"
                )
                if pr_response.status_code >= 400:
                    return self._error_context(
                        repo_owner,
                        repo_name,
                        pull_number,
                        pr_response,
                    )
                pr_payload = pr_response.json()
                files = await self._fetch_pr_files(client, repo_owner, repo_name, pull_number)
        except httpx.HTTPError as exc:
            return GitHubPRContext(
                available=False,
                mock=False,
                message=f"GitHub PR context fetch failed: {exc}",
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_full_name=f"{repo_owner}/{repo_name}",
                pull_number=pull_number,
            )

        terraform_files = [
            file
            for file in files
            if file.filename.endswith(".tf")
            or file.filename.endswith(".tfvars")
            or "terraform" in file.filename.lower()
        ]
        return GitHubPRContext(
            available=True,
            mock=False,
            message="Fetched live GitHub PR metadata and changed-file context.",
            repo_owner=repo_owner,
            repo_name=repo_name,
            repo_full_name=f"{repo_owner}/{repo_name}",
            pull_number=pull_number,
            title=pr_payload.get("title"),
            state=pr_payload.get("state"),
            draft=pr_payload.get("draft"),
            author=(pr_payload.get("user") or {}).get("login"),
            base_ref=(pr_payload.get("base") or {}).get("ref"),
            head_ref=(pr_payload.get("head") or {}).get("ref"),
            html_url=pr_payload.get("html_url"),
            latest_commit_sha=(pr_payload.get("head") or {}).get("sha"),
            changed_files_count=pr_payload.get("changed_files") or len(files),
            additions=pr_payload.get("additions") or sum(file.additions for file in files),
            deletions=pr_payload.get("deletions") or sum(file.deletions for file in files),
            labels=[label.get("name", "") for label in pr_payload.get("labels", []) if label.get("name")],
            requested_reviewers=[
                reviewer.get("login", "")
                for reviewer in pr_payload.get("requested_reviewers", [])
                if reviewer.get("login")
            ],
            files=files,
            terraform_files=terraform_files,
        )

    async def post_pr_comment(
        self,
        repo_owner: str | None,
        repo_name: str | None,
        pull_number: int | None,
        body: str,
    ) -> GitHubPostResult:
        if not repo_owner or not repo_name or not pull_number:
            return GitHubPostResult(
                posted=False,
                mock=True,
                message="GitHub repo metadata is missing. In dev mode this is a mock post.",
            )

        if not self.token:
            return GitHubPostResult(
                posted=False,
                mock=True,
                message=(
                    f"GITHUB_TOKEN is not configured. Would post to "
                    f"{repo_owner}/{repo_name} PR #{pull_number}."
                ),
            )

        try:
            async with self._client() as client:
                response = await client.post(
                    f"/repos/{repo_owner}/{repo_name}/issues/{pull_number}/comments",
                    json={"body": body},
                )
                if response.status_code >= 400:
                    return GitHubPostResult(
                        posted=False,
                        mock=False,
                        message=(
                            f"GitHub rejected the comment request with HTTP "
                            f"{response.status_code}: {_github_error_message(response)}"
                        ),
                    )
                payload = response.json()
                return GitHubPostResult(
                    posted=True,
                    mock=False,
                    message="Posted CloudOps AI review comment to GitHub.",
                    comment_url=payload.get("html_url"),
                )
        except httpx.HTTPError as exc:
            return GitHubPostResult(
                posted=False,
                mock=False,
                message=f"GitHub comment request failed: {exc}",
            )

    async def _fetch_pr_files(
        self,
        client: httpx.AsyncClient,
        repo_owner: str,
        repo_name: str,
        pull_number: int,
    ) -> list[GitHubPRFile]:
        files: list[GitHubPRFile] = []
        for page in range(1, 4):
            response = await client.get(
                f"/repos/{repo_owner}/{repo_name}/pulls/{pull_number}/files",
                params={"per_page": 100, "page": page},
            )
            if response.status_code >= 400:
                break
            payload = response.json()
            files.extend(
                GitHubPRFile(
                    filename=item.get("filename", ""),
                    status=item.get("status", "modified"),
                    additions=item.get("additions") or 0,
                    deletions=item.get("deletions") or 0,
                    changes=item.get("changes") or 0,
                    patch=_truncate_patch(item.get("patch")),
                    raw_url=item.get("raw_url"),
                    blob_url=item.get("blob_url"),
                )
                for item in payload
            )
            if len(payload) < 100:
                break
        return files

    def _client(self) -> httpx.AsyncClient:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        if self.token:
            headers["Authorization"] = f"Bearer {self.token}"
        return httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=20,
            transport=self.transport,
        )

    def _error_context(
        self,
        repo_owner: str,
        repo_name: str,
        pull_number: int,
        response: httpx.Response,
    ) -> GitHubPRContext:
        return GitHubPRContext(
            available=False,
            mock=False,
            message=(
                f"GitHub PR context fetch returned HTTP {response.status_code}: "
                f"{_github_error_message(response)}"
            ),
            repo_owner=repo_owner,
            repo_name=repo_name,
            repo_full_name=f"{repo_owner}/{repo_name}",
            pull_number=pull_number,
        )


def _truncate_patch(patch: str | None, limit: int = 4000) -> str | None:
    if not patch:
        return None
    if len(patch) <= limit:
        return patch
    return f"{patch[:limit]}\n... [patch truncated]"


def _github_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:300]
    message = payload.get("message")
    if isinstance(message, str):
        return message
    return str(payload)[:300]
