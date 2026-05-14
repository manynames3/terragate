from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.config import Settings
from app.services.terraform_plan import validate_terraform_plan


@dataclass
class TerraformSandboxResult:
    plan: dict[str, Any]
    metadata: dict[str, Any]


class TerraformSandboxError(RuntimeError):
    pass


class TerraformSandboxRunner:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.root = settings.sandbox_root

    def create_plan_json(
        self,
        working_dir: str | None,
        *,
        workspace: str | None = None,
        env_vars: dict[str, str] | None = None,
        backend_config: dict[str, str] | None = None,
        backend_enabled: bool = False,
        var_file: str | None = None,
    ) -> TerraformSandboxResult:
        if not self.settings.terraform_sandbox_enabled:
            raise TerraformSandboxError(
                "Terraform sandbox execution is disabled. Set TERRAFORM_SANDBOX_ENABLED=true and place code under TERRAFORM_SANDBOX_ROOT."
            )
        if not working_dir:
            raise TerraformSandboxError("terraform_working_dir is required for sandbox execution.")
        driver = (self.settings.terraform_sandbox_driver or "local").lower()
        if driver == "local" and shutil.which("terraform") is None:
            raise TerraformSandboxError("Terraform CLI is not installed or is not on PATH.")
        if driver == "docker" and shutil.which("docker") is None:
            raise TerraformSandboxError("Docker is not installed or is not on PATH.")
        if driver not in {"local", "docker"}:
            raise TerraformSandboxError("TERRAFORM_SANDBOX_DRIVER must be 'local' or 'docker'.")

        source = self._resolve_working_dir(working_dir)
        with tempfile.TemporaryDirectory(prefix="terragate-tf-", dir=self.root) as temp_dir:
            isolated = Path(temp_dir) / "workspace"
            shutil.copytree(source, isolated, ignore=shutil.ignore_patterns(".terraform", ".git", "terraform.tfstate*"))
            plan_path = "tfplan.binary"
            json_path = isolated / "tfplan.json"
            env = self._sandbox_env(env_vars)
            init_command = ["terraform", "init", "-input=false", "-no-color"]
            if backend_enabled:
                init_command.extend(f"-backend-config={key}={value}" for key, value in (backend_config or {}).items())
            else:
                init_command.append("-backend=false")
            plan_command = [
                "terraform",
                "plan",
                "-refresh=false",
                "-input=false",
                "-lock=false",
                "-out",
                plan_path,
                "-no-color",
            ]
            if var_file:
                resolved_var_file = self._resolve_relative_file(source, var_file)
                plan_command.append(f"-var-file={resolved_var_file.relative_to(source)}")
            commands = [
                init_command,
                plan_command,
                ["terraform", "show", "-json", str(plan_path)],
            ]
            self._run(commands[0], isolated, env)
            if workspace:
                self._select_workspace(isolated, env, workspace)
            self._run(commands[1], isolated, env)
            show = self._run(commands[2], isolated, env)
            json_path.write_text(show.stdout)
            plan = json.loads(show.stdout)
            validate_terraform_plan(plan)
            return TerraformSandboxResult(
                plan=plan,
                metadata={
                    "mode": "sandbox_plan",
                    "enabled": True,
                    "driver": driver,
                    "container_image": self.settings.terraform_sandbox_image if driver == "docker" else None,
                    "container_network": self.settings.terraform_sandbox_network if driver == "docker" else None,
                    "source_working_dir": str(source),
                    "terraform_working_dir": str(isolated),
                    "plan_json_path": str(json_path),
                    "refresh": False,
                    "backend": backend_enabled,
                    "workspace": workspace,
                    "env_var_keys": sorted((env_vars or {}).keys()),
                    "backend_config_keys": sorted((backend_config or {}).keys()),
                    "var_file": var_file,
                    "commands": [" ".join(command) for command in commands],
                    "warnings": [
                        "Sandbox execution copies code into an isolated temp directory.",
                        (
                            "Terraform runs inside a container with the configured Docker network policy."
                            if driver == "docker"
                            else "Terraform runs on the local host; use TERRAFORM_SANDBOX_DRIVER=docker for stronger isolation."
                        ),
                        "Provider plugins may still be downloaded during terraform init.",
                        "Plan execution uses -refresh=false and -backend=false for safer local review.",
                    ],
                },
            )

    def _resolve_working_dir(self, working_dir: str) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        candidate = (self.root / working_dir).resolve() if not Path(working_dir).is_absolute() else Path(working_dir).resolve()
        try:
            candidate.relative_to(self.root.resolve())
        except ValueError as exc:
            raise TerraformSandboxError("terraform_working_dir must be inside TERRAFORM_SANDBOX_ROOT.") from exc
        if not candidate.exists() or not candidate.is_dir():
            raise TerraformSandboxError(f"Terraform working directory does not exist under sandbox root: {working_dir}")
        return candidate

    def _resolve_relative_file(self, source: Path, value: str) -> Path:
        candidate = (source / value).resolve()
        try:
            candidate.relative_to(source)
        except ValueError as exc:
            raise TerraformSandboxError("terraform_var_file must be inside the Terraform working directory.") from exc
        if not candidate.exists() or not candidate.is_file():
            raise TerraformSandboxError(f"Terraform var file does not exist: {value}")
        return candidate

    def _sandbox_env(self, env_vars: dict[str, str] | None = None) -> dict[str, str]:
        allowed_prefixes = ("TF_",)
        allowed_names = {"PATH", "HOME", "LANG", "LC_ALL", "TMPDIR"}
        env = {
            key: value
            for key, value in os.environ.items()
            if key in allowed_names or key.startswith(allowed_prefixes)
        }
        for key, value in (env_vars or {}).items():
            if not key.startswith(("TF_", "AWS_", "AZURE_", "ARM_", "GOOGLE_", "CLOUDSDK_")):
                raise TerraformSandboxError(f"Environment variable is not allowed in sandbox: {key}")
            env[key] = str(value)
        env["TF_IN_AUTOMATION"] = "1"
        env["CHECKPOINT_DISABLE"] = "1"
        return env

    def _run(self, command: list[str], cwd: Path, env: dict[str, str]) -> subprocess.CompletedProcess[str]:
        executable = self._execution_command(command, cwd, env)
        try:
            return subprocess.run(
                executable,
                cwd=cwd,
                env=env,
                capture_output=True,
                text=True,
                timeout=self.settings.terraform_plan_timeout_seconds,
                check=True,
            )
        except subprocess.CalledProcessError as exc:
            detail = (exc.stderr or exc.stdout or str(exc)).strip()
            raise TerraformSandboxError(f"Terraform command failed: {' '.join(command)}\n{detail}") from exc
        except subprocess.TimeoutExpired as exc:
            raise TerraformSandboxError(f"Terraform command timed out: {' '.join(command)}") from exc

    def _execution_command(self, command: list[str], cwd: Path, env: dict[str, str]) -> list[str]:
        driver = (self.settings.terraform_sandbox_driver or "local").lower()
        if driver == "local":
            return command
        terraform_args = command[1:] if command and command[0] == "terraform" else command
        docker_command = [
            "docker",
            "run",
            "--rm",
            "--network",
            self.settings.terraform_sandbox_network,
            "-v",
            f"{cwd}:/workspace",
            "-w",
            "/workspace",
        ]
        for key in sorted(env):
            if key.startswith(("TF_", "AWS_", "AZURE_", "ARM_", "GOOGLE_", "CLOUDSDK_")):
                docker_command.extend(["-e", key])
        return [
            *docker_command,
            "--entrypoint",
            "terraform",
            self.settings.terraform_sandbox_image,
            *terraform_args,
        ]

    def _select_workspace(self, cwd: Path, env: dict[str, str], workspace: str) -> None:
        if not workspace.replace("-", "").replace("_", "").isalnum():
            raise TerraformSandboxError("Terraform workspace contains unsupported characters.")
        try:
            self._run(["terraform", "workspace", "select", workspace, "-no-color"], cwd, env)
            return
        except TerraformSandboxError:
            pass
        self._run(["terraform", "workspace", "new", workspace, "-no-color"], cwd, env)
