from __future__ import annotations

from copy import deepcopy
from typing import Any

from app.services.terraform_plan import redact_sensitive_text


def redact_github_patch_context(payload: dict[str, Any]) -> dict[str, Any]:
    redacted = deepcopy(payload)
    for collection_name in ("files", "terraform_files"):
        files = redacted.get(collection_name)
        if not isinstance(files, list):
            continue
        for file in files:
            if not isinstance(file, dict):
                continue
            patch = file.get("patch")
            if isinstance(patch, str):
                file["patch"] = redact_sensitive_text(patch)
    return redacted
