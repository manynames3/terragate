import hashlib
import json
from pathlib import Path
from typing import Any


class FileSystemArtifactStore:
    def __init__(self, root: Path):
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)

    def run_dir(self, run_id: str) -> Path:
        path = self.root / run_id
        path.mkdir(parents=True, exist_ok=True)
        return path

    def write_bytes(self, run_id: str, name: str, data: bytes) -> tuple[str, str]:
        safe_name = Path(name).name or "artifact.bin"
        path = self.run_dir(run_id) / safe_name
        path.write_bytes(data)
        return str(path), hashlib.sha256(data).hexdigest()

    def write_json(self, run_id: str, name: str, data: Any) -> tuple[str, str]:
        payload = json.dumps(data, indent=2, sort_keys=True).encode("utf-8")
        return self.write_bytes(run_id, name, payload)

    def read_json(self, storage_uri: str) -> Any:
        return json.loads(Path(storage_uri).read_text())
