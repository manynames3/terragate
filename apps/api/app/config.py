from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = Field(default="development", alias="APP_ENV")
    database_url: str | None = Field(default=None, alias="DATABASE_URL")
    openai_api_key: str | None = Field(default=None, alias="OPENAI_API_KEY")
    openai_model: str = Field(default="gpt-5.4-mini", alias="OPENAI_MODEL")
    langsmith_api_key: str | None = Field(default=None, alias="LANGSMITH_API_KEY")
    langsmith_project: str = Field(
        default="cloudops-ai-command-center", alias="LANGSMITH_PROJECT"
    )
    langsmith_tracing: str = Field(default="true", alias="LANGSMITH_TRACING")
    github_token: str | None = Field(default=None, alias="GITHUB_TOKEN")
    github_app_id: str | None = Field(default=None, alias="GITHUB_APP_ID")
    github_app_installation_id: str | None = Field(default=None, alias="GITHUB_APP_INSTALLATION_ID")
    github_app_private_key: str | None = Field(default=None, alias="GITHUB_APP_PRIVATE_KEY")
    github_app_private_key_path: str | None = Field(default=None, alias="GITHUB_APP_PRIVATE_KEY_PATH")
    github_webhook_secret: str | None = Field(default=None, alias="GITHUB_WEBHOOK_SECRET")
    github_webhook_terraform_working_dir: str | None = Field(
        default=None, alias="GITHUB_WEBHOOK_TERRAFORM_WORKING_DIR"
    )
    github_webhook_environment: str = Field(default="dev", alias="GITHUB_WEBHOOK_ENVIRONMENT")
    github_webhook_cloud_provider: str = Field(default="aws", alias="GITHUB_WEBHOOK_CLOUD_PROVIDER")
    github_webhook_policy_profile: str = Field(default="default", alias="GITHUB_WEBHOOK_POLICY_PROFILE")
    infracost_api_key: str | None = Field(default=None, alias="INFRACOST_API_KEY")
    review_execution_mode: str = Field(default="background", alias="REVIEW_EXECUTION_MODE")
    review_node_max_attempts: int = Field(default=3, alias="REVIEW_NODE_MAX_ATTEMPTS")
    worker_poll_interval_seconds: float = Field(default=2.0, alias="WORKER_POLL_INTERVAL_SECONDS")
    worker_batch_size: int = Field(default=1, alias="WORKER_BATCH_SIZE")
    terraform_sandbox_enabled: bool = Field(default=False, alias="TERRAFORM_SANDBOX_ENABLED")
    terraform_sandbox_root: str = Field(default="./sandbox", alias="TERRAFORM_SANDBOX_ROOT")
    terraform_plan_timeout_seconds: int = Field(default=120, alias="TERRAFORM_PLAN_TIMEOUT_SECONDS")
    terraform_sandbox_driver: str = Field(default="local", alias="TERRAFORM_SANDBOX_DRIVER")
    terraform_sandbox_image: str = Field(default="hashicorp/terraform:1.9", alias="TERRAFORM_SANDBOX_IMAGE")
    terraform_sandbox_network: str = Field(default="none", alias="TERRAFORM_SANDBOX_NETWORK")
    auth_mode: str = Field(default="dev", alias="AUTH_MODE")
    cognito_region: str | None = Field(default=None, alias="COGNITO_REGION")
    cognito_user_pool_id: str | None = Field(default=None, alias="COGNITO_USER_POOL_ID")
    cognito_app_client_id: str | None = Field(default=None, alias="COGNITO_APP_CLIENT_ID")
    cognito_issuer_url: str | None = Field(default=None, alias="COGNITO_ISSUER")
    cognito_jwks_url: str | None = Field(default=None, alias="COGNITO_JWKS_URL")
    cognito_admin_group: str = Field(default="cloudops-admins", alias="COGNITO_ADMIN_GROUP")
    cognito_reviewer_group: str = Field(default="cloudops-reviewers", alias="COGNITO_REVIEWER_GROUP")
    cognito_viewer_group: str = Field(default="cloudops-viewers", alias="COGNITO_VIEWER_GROUP")
    cognito_org_claim: str = Field(default="custom:org_id", alias="COGNITO_ORG_CLAIM")
    artifact_storage_dir: str = Field(default="./artifacts", alias="ARTIFACT_STORAGE_DIR")
    cors_origins: str = Field(
        default="http://localhost:3000,http://127.0.0.1:3000",
        alias="CORS_ORIGINS",
    )

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return "sqlite:///./cloudops_dev.db"

    @property
    def artifact_root(self) -> Path:
        return Path(self.artifact_storage_dir).expanduser().resolve()

    @property
    def sandbox_root(self) -> Path:
        return Path(self.terraform_sandbox_root).expanduser().resolve()

    @property
    def resolved_cognito_issuer(self) -> str | None:
        if self.cognito_issuer_url:
            return self.cognito_issuer_url.rstrip("/")
        if self.cognito_region and self.cognito_user_pool_id:
            return f"https://cognito-idp.{self.cognito_region}.amazonaws.com/{self.cognito_user_pool_id}"
        return None

    @property
    def resolved_cognito_jwks_url(self) -> str | None:
        if self.cognito_jwks_url:
            return self.cognito_jwks_url
        issuer = self.resolved_cognito_issuer
        if issuer:
            return f"{issuer}/.well-known/jwks.json"
        return None

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
