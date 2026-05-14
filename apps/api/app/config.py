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
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
