import base64
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import jwt

from app.services.terraform_plan import redact_sensitive_text
from app.services.patch_application import PatchValidationError, apply_reviewed_patch


@dataclass
class GitHubPostResult:
    posted: bool
    mock: bool
    message: str
    comment_url: str | None = None


@dataclass
class GitHubCheckResult:
    posted: bool
    mock: bool
    status: str
    conclusion: str | None
    message: str
    external_id: str | None = None
    check_url: str | None = None


@dataclass
class GitHubPatchCommitResult:
    committed: bool
    mock: bool
    message: str
    commit_url: str | None = None


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
        app_id: str | None = None,
        app_private_key: str | None = None,
        app_private_key_path: str | None = None,
        app_installation_id: str | None = None,
        base_url: str = "https://api.github.com",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.token = token
        self.app_id = app_id
        self.app_private_key = app_private_key
        self.app_private_key_path = app_private_key_path
        self.app_installation_id = app_installation_id
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

        token = await self._auth_token()
        if not token:
            return GitHubPRContext(
                available=False,
                mock=True,
                message=(
                    "GITHUB_TOKEN or GitHub App credentials are not configured. PR context will be stored as a "
                    "dev placeholder and comment posting will use the approval-gated mock path."
                ),
                repo_owner=repo_owner,
                repo_name=repo_name,
                repo_full_name=f"{repo_owner}/{repo_name}",
                pull_number=pull_number,
            )

        try:
            async with self._client(token) as client:
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

        token = await self._auth_token()
        if not token:
            return GitHubPostResult(
                posted=False,
                mock=True,
                message=(
                    f"GITHUB_TOKEN or GitHub App credentials are not configured. Would post to "
                    f"{repo_owner}/{repo_name} PR #{pull_number}."
                ),
            )

        try:
            async with self._client(token) as client:
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
                    message="Posted TerraGate review comment to GitHub.",
                    comment_url=payload.get("html_url"),
                )
        except httpx.HTTPError as exc:
            return GitHubPostResult(
                posted=False,
                mock=False,
                message=f"GitHub comment request failed: {exc}",
            )

    async def create_check_run(
        self,
        repo_owner: str | None,
        repo_name: str | None,
        head_sha: str | None,
        *,
        status: str,
        conclusion: str | None = None,
        summary: str = "",
        details_url: str | None = None,
        external_id: str | None = None,
    ) -> GitHubCheckResult:
        if not repo_owner or not repo_name or not head_sha:
            return GitHubCheckResult(
                posted=False,
                mock=True,
                status=status,
                conclusion=conclusion,
                message="GitHub repo metadata or PR head SHA is missing. Would create a PR check in production.",
            )
        token = await self._auth_token()
        if not token:
            return GitHubCheckResult(
                posted=False,
                mock=True,
                status=status,
                conclusion=conclusion,
                message="GITHUB_TOKEN or GitHub App credentials are not configured. Would create a PR check in production.",
            )

        payload: dict[str, Any] = {
            "name": "TerraGate Terraform Review",
            "head_sha": head_sha,
            "status": status,
            "external_id": external_id,
            "output": {
                "title": "TerraGate Terraform Review",
                "summary": summary[:65000],
            },
        }
        if details_url:
            payload["details_url"] = details_url
        if status == "completed":
            payload["conclusion"] = conclusion or "neutral"
            payload["completed_at"] = datetime.now(timezone.utc).isoformat()

        try:
            async with self._client(token) as client:
                response = await client.post(
                    f"/repos/{repo_owner}/{repo_name}/check-runs",
                    json=payload,
                )
                if response.status_code >= 400:
                    return GitHubCheckResult(
                        posted=False,
                        mock=False,
                        status=status,
                        conclusion=conclusion,
                        message=(
                            f"GitHub rejected the check run with HTTP {response.status_code}: "
                            f"{_github_error_message(response)}"
                        ),
                    )
                data = response.json()
                return GitHubCheckResult(
                    posted=True,
                    mock=False,
                    status=data.get("status") or status,
                    conclusion=data.get("conclusion") or conclusion,
                    message="Created GitHub check run.",
                    external_id=str(data.get("id")) if data.get("id") else external_id,
                    check_url=data.get("html_url"),
                )
        except httpx.HTTPError as exc:
            return GitHubCheckResult(
                posted=False,
                mock=False,
                status=status,
                conclusion=conclusion,
                message=f"GitHub check run request failed: {exc}",
            )

    async def commit_patch_to_pr_branch(
        self,
        repo_owner: str | None,
        repo_name: str | None,
        pull_number: int | None,
        file_path: str | None,
        diff: str,
        *,
        commit_message: str,
        expected_head_sha: str | None = None,
    ) -> GitHubPatchCommitResult:
        if not repo_owner or not repo_name or not pull_number or not file_path:
            return GitHubPatchCommitResult(
                committed=False,
                mock=True,
                message="GitHub repo metadata, PR number, or patch file path is missing. Would commit the approved patch in production.",
            )
        if not expected_head_sha or not re.fullmatch(r"[a-f0-9]{40}", expected_head_sha):
            return GitHubPatchCommitResult(
                committed=False,
                mock=False,
                message="An immutable reviewed PR commit is required. Export snippets instead of committing unverified changes.",
            )
        token = await self._auth_token()
        if not token:
            return GitHubPatchCommitResult(
                committed=False,
                mock=True,
                message=f"GITHUB_TOKEN or GitHub App credentials are not configured. Would commit approved patch to {repo_owner}/{repo_name} PR #{pull_number}.",
            )

        try:
            async with self._client(token) as client:
                pr_response = await client.get(f"/repos/{repo_owner}/{repo_name}/pulls/{pull_number}")
                if pr_response.status_code >= 400:
                    return GitHubPatchCommitResult(
                        committed=False,
                        mock=False,
                        message=f"GitHub rejected PR lookup with HTTP {pr_response.status_code}: {_github_error_message(pr_response)}",
                    )
                pr = pr_response.json()
                head = pr.get("head") or {}
                head_ref = head.get("ref")
                if pr.get("state") != "open" or not head_ref or head.get("sha") != expected_head_sha:
                    return GitHubPatchCommitResult(False, False, "The PR is closed or its head changed. Run a fresh review before committing.")
                head_repo = (head.get("repo") or {}).get("full_name") or f"{repo_owner}/{repo_name}"
                if head_repo != f"{repo_owner}/{repo_name}":
                    return GitHubPatchCommitResult(
                        committed=False,
                        mock=False,
                        message="Fork PR commits are not supported. Export the remediation for the author.",
                    )

                content_response = await client.get(
                    f"/repos/{repo_owner}/{repo_name}/contents/{file_path}",
                    params={"ref": expected_head_sha},
                )
                if content_response.status_code == 200:
                    content_payload = content_response.json()
                    encoded = content_payload.get("content") or ""
                    existing_content = base64.b64decode(encoded).decode()
                else:
                    return GitHubPatchCommitResult(
                        committed=False,
                        mock=False,
                        message=f"GitHub rejected file lookup with HTTP {content_response.status_code}: {_github_error_message(content_response)}",
                    )

                new_content = apply_reviewed_patch(existing_content, diff, file_path)
                prefix = f"/repos/{repo_owner}/{repo_name}/git"
                parent_response = await client.get(f"{prefix}/commits/{expected_head_sha}")
                parent_response.raise_for_status()
                blob_response = await client.post(f"{prefix}/blobs", json={"content": new_content, "encoding": "utf-8"})
                blob_response.raise_for_status()
                tree_response = await client.post(f"{prefix}/trees", json={
                    "base_tree": parent_response.json()["tree"]["sha"],
                    "tree": [{"path": file_path, "mode": "100644", "type": "blob", "sha": blob_response.json()["sha"]}],
                })
                tree_response.raise_for_status()
                commit_response = await client.post(f"{prefix}/commits", json={
                    "message": commit_message, "tree": tree_response.json()["sha"], "parents": [expected_head_sha],
                })
                commit_response.raise_for_status()
                commit = commit_response.json()
                # A non-force ref update rejects a concurrent commit instead of overwriting it.
                response = await client.patch(f"{prefix}/refs/heads/{head_ref}", json={"sha": commit["sha"], "force": False})
                if response.status_code >= 400:
                    return GitHubPatchCommitResult(False, False, "GitHub rejected the branch update; it may have changed during validation. Run a fresh review.")
                return GitHubPatchCommitResult(
                    committed=True,
                    mock=False,
                    message="Committed approved TerraGate patch to the PR branch.",
                    commit_url=commit.get("html_url"),
                )
        except (PatchValidationError, ValueError, KeyError) as exc:
            return GitHubPatchCommitResult(False, False, f"Patch validation failed: {exc}")
        except httpx.HTTPError as exc:
            return GitHubPatchCommitResult(
                committed=False,
                mock=False,
                message=f"GitHub patch commit request failed: {exc}",
            )

    async def verify_pr_head(self, repo_owner: str | None, repo_name: str | None,
                             pull_number: int | None, expected_head_sha: str | None) -> str | None:
        if not repo_owner or not repo_name or not pull_number:
            return None
        token = await self._auth_token()
        if not token:
            return None  # Credentials-free mode never performs a live write.
        if not expected_head_sha:
            return "No live PR commit was captured by this review. Run a new review with GitHub access before posting."
        try:
            async with self._client(token) as client:
                response = await client.get(f"/repos/{repo_owner}/{repo_name}/pulls/{pull_number}")
                response.raise_for_status()
                pr = response.json()
                if pr.get("state") != "open" or (pr.get("head") or {}).get("sha") != expected_head_sha:
                    return "The PR is closed or its head changed since review. Run a new review before approving or posting."
        except (httpx.HTTPError, ValueError) as exc:
            return f"GitHub could not verify the reviewed PR commit. No write was made: {exc}"
        return None

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

    async def _auth_token(self) -> str | None:
        if self.token:
            return self.token
        if not self.app_id or not self.app_installation_id:
            return None
        private_key = self._private_key()
        if not private_key:
            return None
        now = datetime.now(timezone.utc)
        app_jwt = jwt.encode(
            {
                "iat": int((now - timedelta(seconds=60)).timestamp()),
                "exp": int((now + timedelta(minutes=9)).timestamp()),
                "iss": self.app_id,
            },
            private_key,
            algorithm="RS256",
        )
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Authorization": f"Bearer {app_jwt}",
        }
        async with httpx.AsyncClient(
            base_url=self.base_url,
            headers=headers,
            timeout=20,
            transport=self.transport,
        ) as client:
            response = await client.post(f"/app/installations/{self.app_installation_id}/access_tokens")
            if response.status_code >= 400:
                return None
            token = response.json().get("token")
            return token if isinstance(token, str) else None

    def _private_key(self) -> str | None:
        if self.app_private_key:
            return self.app_private_key.replace("\\n", "\n")
        if self.app_private_key_path:
            return Path(self.app_private_key_path).expanduser().read_text()
        return None

    def _client(self, token: str) -> httpx.AsyncClient:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "Authorization": f"Bearer {token}",
        }
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
    redacted_patch = redact_sensitive_text(patch)
    if len(redacted_patch) <= limit:
        return redacted_patch
    return f"{redacted_patch[:limit]}\n... [patch truncated]"


def _github_error_message(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return response.text[:300]
    message = payload.get("message")
    if isinstance(message, str):
        return message
    return str(payload)[:300]
