from datetime import datetime, timezone
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import DateTime, Integer, JSON, MetaData, create_engine, select


def test_existing_runs_and_legacy_patches_survive_provenance_upgrade(tmp_path) -> None:
    api_root = Path(__file__).resolve().parents[2]
    config = Config(str(api_root / "alembic.ini"))
    config.set_main_option("script_location", str(api_root / "alembic"))
    url = f"sqlite:///{tmp_path / 'legacy.db'}"
    config.set_main_option("sqlalchemy.url", url)
    command.upgrade(config, "0007_run_org_scope")
    engine = create_engine(url)
    metadata = MetaData()
    metadata.reflect(bind=engine)

    def required_values(table):
        values = {}
        for column in table.columns:
            if column.nullable:
                continue
            if isinstance(column.type, Integer):
                values[column.name] = 0
            elif isinstance(column.type, JSON):
                values[column.name] = {}
            elif isinstance(column.type, DateTime):
                values[column.name] = datetime.now(timezone.utc)
            else:
                values[column.name] = ""
        return values

    runs = metadata.tables["runs"]
    patches = metadata.tables["fix_patches"]
    with engine.begin() as connection:
        connection.execute(runs.insert().values({**required_values(runs), "id": "run_legacy", "pr_comment_draft": "Preserve this draft", "approval_status": "approved"}))
        connection.execute(patches.insert().values({**required_values(patches), "id": "fix_legacy", "run_id": "run_legacy", "status": "approved", "diff": "@@\n+old unsafe snippet"}))

    command.upgrade(config, "head")
    upgraded = MetaData()
    upgraded.reflect(bind=engine)
    with engine.connect() as connection:
        run = connection.execute(select(upgraded.tables["runs"])).mappings().one()
        patch = connection.execute(select(upgraded.tables["fix_patches"])).mappings().one()
        assert run["pr_comment_draft"] == "Preserve this draft"
        assert run["approved_snapshot_hash"] is None
        assert run["policy_snapshot"] == {}
        assert patch["kind"] == "snippet"
        assert patch["approved_snapshot_hash"] is None
        assert patch["diff"] == "@@\n+old unsafe snippet"
    command.downgrade(config, "0007_run_org_scope")
    engine.dispose()
