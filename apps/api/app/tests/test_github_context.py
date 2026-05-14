from app.services.github_context import redact_github_patch_context


def test_redacts_github_patch_context_before_artifact_storage() -> None:
    payload = {
        "files": [
            {
                "filename": "infra/main.tf",
                "patch": '+  password = "super-secret"\n+  name = "safe"',
            }
        ],
        "terraform_files": [
            {
                "filename": "infra/key.tf",
                "patch": "\n".join(
                    [
                        "+  private_key = <<EOT",
                        "+  raw-private-key",
                        "+  EOT",
                    ]
                ),
            }
        ],
    }

    redacted = redact_github_patch_context(payload)

    assert "super-secret" in payload["files"][0]["patch"]
    assert "super-secret" not in redacted["files"][0]["patch"]
    assert "raw-private-key" not in redacted["terraform_files"][0]["patch"]
    assert "safe" in redacted["files"][0]["patch"]
