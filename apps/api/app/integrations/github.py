from dataclasses import dataclass

import httpx


@dataclass
class GitHubPostResult:
    posted: bool
    mock: bool
    message: str
    comment_url: str | None = None


class GitHubClient:
    def __init__(self, token: str | None):
        self.token = token

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

        url = f"https://api.github.com/repos/{repo_owner}/{repo_name}/issues/{pull_number}/comments"
        headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {self.token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(url, headers=headers, json={"body": body})
            response.raise_for_status()
            payload = response.json()
            return GitHubPostResult(
                posted=True,
                mock=False,
                message="Posted CloudOps AI review comment to GitHub.",
                comment_url=payload.get("html_url"),
            )
