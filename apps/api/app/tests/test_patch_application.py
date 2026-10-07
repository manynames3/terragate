from difflib import unified_diff
import shutil

import pytest

from app.services.fix_patches import suggested_fix_patches
from app.services.patch_application import PatchValidationError, apply_reviewed_patch


def diff_for(before: str, after: str, path: str = "main.tf") -> str:
    return f"diff --git a/{path} b/{path}\n" + "".join(unified_diff(
        before.splitlines(keepends=True), after.splitlines(keepends=True), fromfile=f"a/{path}", tofile=f"b/{path}",
    ))


@pytest.mark.skipif(not shutil.which("terraform") or not shutil.which("git"), reason="Real patch integration requires Git and Terraform")
def test_real_patch_replaces_removed_lines_instead_of_appending() -> None:
    before = 'variable "retention" {\n  default = 0\n}\n'
    after = 'variable "retention" {\n  default = 7\n}\n'
    assert apply_reviewed_patch(before, diff_for(before, after), "main.tf") == after


@pytest.mark.skipif(not shutil.which("terraform") or not shutil.which("git"), reason="Real patch integration requires Git and Terraform")
def test_changed_context_and_invalid_terraform_fail_validation() -> None:
    before = 'variable "retention" {\n  default = 0\n}\n'
    after = 'variable "retention" {\n  default = 7\n}\n'
    with pytest.raises(PatchValidationError):
        apply_reviewed_patch(before.replace("0", "1"), diff_for(before, after), "main.tf")
    with pytest.raises(PatchValidationError):
        apply_reviewed_patch(before, diff_for(before, 'variable "retention" {\n  default = [\n}\n'), "main.tf")


@pytest.mark.parametrize("path", ["../main.tf", "/main.tf", "a/../../main.tf", "a//main.tf", ".terraform/main.tf", "main.txt"])
def test_patch_cannot_escape_or_target_non_terraform_files(path: str) -> None:
    with pytest.raises(PatchValidationError):
        apply_reviewed_patch("before\n", diff_for("before\n", "after\n", path), path)


def test_snippets_multiple_files_and_redacted_context_are_not_applicable_patches() -> None:
    patch = diff_for("before\n", "after\n")
    for invalid in ["@@\n+snippet", patch + diff_for("a\n", "b\n", "other.tf"), patch.replace("after", "[REDACTED]"), ""]:
        with pytest.raises(PatchValidationError):
            apply_reviewed_patch("before\n", invalid, "main.tf")


def test_missing_validation_tools_fail_closed(monkeypatch) -> None:
    monkeypatch.setattr(shutil, "which", lambda name: None)
    with pytest.raises(PatchValidationError, match="must be installed"):
        apply_reviewed_patch("before\n", diff_for("before\n", "after\n"), "main.tf")


def test_generated_remediation_is_a_snippet_without_fabricated_file_mapping() -> None:
    suggestions = suggested_fix_patches([{
        "id": "finding", "title": "Retention disabled", "severity": "high", "resource_type": "aws_db_instance",
        "remediation": {"snippet": "backup_retention_period = 7", "explanation": "Enable retention"},
    }])
    assert suggestions[0]["kind"] == "snippet"
    assert suggestions[0]["pr_file_path"] is None
    assert suggestions[0]["snippet"] == "backup_retention_period = 7"
    assert suggestions[0]["diff"] == ""
