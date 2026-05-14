from app.graph.terraform_review.nodes.pr_context import map_github_pr_context


def test_maps_finding_to_changed_terraform_pr_file() -> None:
    state = {
        "graph_progress": [],
        "repo_context": {
            "github_pr_context": {
                "terraform_files": [
                    {
                        "filename": "infra/security-groups.tf",
                        "status": "modified",
                        "blob_url": "https://github.com/acme/infra/blob/abc/infra/security-groups.tf",
                        "patch": "\n".join(
                            [
                                "@@ -1,3 +1,12 @@",
                                '+resource "aws_security_group" "web" {',
                                '+  name = "web"',
                                "+  ingress {",
                                "+    from_port = 22",
                                '+    cidr_blocks = ["0.0.0.0/0"]',
                                "+  }",
                                "+}",
                            ]
                        ),
                    }
                ],
            }
        },
        "merged_findings": [
            {
                "id": "fnd_1",
                "title": "Public SSH ingress",
                "resource_address": "aws_security_group.web",
                "resource_type": "aws_security_group",
                "evidence": [],
            }
        ],
    }

    result = map_github_pr_context(state)
    finding = result["merged_findings"][0]

    assert finding["pr_file_path"] == "infra/security-groups.tf"
    assert finding["pr_file_url"] == "https://github.com/acme/infra/blob/abc/infra/security-groups.tf"
    assert 'resource "aws_security_group" "web"' in finding["pr_patch"]
    assert finding["evidence"][0]["rule_id"] == "GITHUB-PR-CONTEXT"
    assert result["graph_progress"][-1]["node"] == "map_github_pr_context"
