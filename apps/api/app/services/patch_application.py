from __future__ import annotations

from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
from tempfile import TemporaryDirectory


class PatchValidationError(ValueError):
    pass


def apply_reviewed_patch(original: str, diff: str, file_path: str) -> str:
    path = PurePosixPath(file_path)
    if (not re.fullmatch(r"[A-Za-z0-9_./-]+\.tf", file_path) or path.is_absolute()
            or ".." in path.parts or str(path) != file_path or ".terraform" in path.parts):
        raise PatchValidationError("Only a normalized repository-relative .tf file can be patched.")
    lines = diff.splitlines()
    if (sum(line.startswith("diff --git ") for line in lines) != 1
            or lines[0] != f"diff --git a/{file_path} b/{file_path}"
            or [line for line in lines if line.startswith("--- ")] != [f"--- a/{file_path}"]
            or [line for line in lines if line.startswith("+++ ")] != [f"+++ b/{file_path}"]
            or not any(re.match(r"^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@", line) for line in lines)
            or any(line.startswith(("new file mode", "deleted file mode", "old mode", "new mode", "rename ", "copy ")) for line in lines)
            or "[REDACTED]" in diff or "[patch truncated]" in diff):
        raise PatchValidationError("A complete single-file unified diff is required; snippets and truncated patches cannot be committed.")
    git = shutil.which("git")
    terraform = shutil.which("terraform")
    if not git or not terraform:
        raise PatchValidationError("Git and Terraform must be installed to validate patches. Export the snippet instead.")

    with TemporaryDirectory(prefix="terragate-patch-") as directory:
        root = Path(directory)
        target = root / file_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(original, encoding="utf-8")
        patch_file = root / "review.diff"
        patch_file.write_text(diff, encoding="utf-8")
        try:
            # Git verifies hunk context and removals; no shell, init, provider execution or plan is run.
            for arguments in [
                [git, "apply", "--check", "--whitespace=error-all", str(patch_file)],
                [git, "apply", "--whitespace=error-all", str(patch_file)],
                [terraform, "fmt", "-check", "-no-color", str(target)],
            ]:
                result = subprocess.run(arguments, cwd=root, capture_output=True, text=True, timeout=15)
                if result.returncode:
                    raise PatchValidationError("Patch context or Terraform syntax/format validation failed. Refresh the source and validate the fix locally.")
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise PatchValidationError("Patch validation could not complete. No GitHub write was made.") from exc
        updated = target.read_text(encoding="utf-8")
        if updated == original:
            raise PatchValidationError("The patch does not change the reviewed file.")
        return updated
