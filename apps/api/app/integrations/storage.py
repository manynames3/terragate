import hashlib
import json
import os
from pathlib import Path
from typing import Any


class FileSystemArtifactStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        path = self.root / run_id
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("Artifact path is outside the configured store.")
        path.mkdir(parents=True, exist_ok=True)
        path.chmod(0o700)
        return path

    def write_bytes(self, run_id: str, name: str, data: bytes) -> tuple[str, str]:
        safe_name = Path(name).name or "artifact.bin"
        path = self.run_dir(run_id) / safe_name
        if not path.resolve().is_relative_to(self.root.resolve()):
            raise ValueError("Artifact path is outside the configured store.")
        # Set permissions before writing sensitive bytes and refuse existing symlinks.
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as handle:
            os.fchmod(handle.fileno(), 0o600)
            handle.write(data)
        return str(path), hashlib.sha256(data).hexdigest()

    def write_json(self, run_id: str, name: str, data: Any) -> tuple[str, str]:
        payload = json.dumps(data, indent=2, sort_keys=True).encode("utf-8")
        return self.write_bytes(run_id, name, payload)

    def read_json(self, storage_uri: str, expected_sha256: str | None = None) -> Any:
        path = Path(storage_uri).resolve()
        if not path.is_relative_to(self.root.resolve()):
            raise ValueError("Artifact path is outside the configured store.")
        data = path.read_bytes()
        if expected_sha256 and hashlib.sha256(data).hexdigest() != expected_sha256:
            raise ValueError("Artifact integrity check failed.")
        return json.loads(data)
