from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.db.session import engine


BASELINE_REVISION = "0001_initial_schema"
APP_TABLES = {
    "users",
    "runs",
    "artifacts",
    "findings",
    "evidence",
    "remediations",
    "approvals",
    "github_comments",
}


def init_db() -> None:
    config = _alembic_config()
    if _has_existing_unversioned_schema():
        command.stamp(config, BASELINE_REVISION)
    command.upgrade(config, "head")


def _alembic_config() -> Config:
    api_root = Path(__file__).resolve().parents[2]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    database_url = engine.url.render_as_string(hide_password=False).replace("%", "%%")
    config.set_main_option("sqlalchemy.url", database_url)
    return config


def _has_existing_unversioned_schema() -> bool:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    return "alembic_version" not in table_names and bool(table_names & APP_TABLES)
