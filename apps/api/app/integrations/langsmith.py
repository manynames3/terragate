import os
from uuid import uuid4

from app.config import Settings


def configure_langsmith(settings: Settings) -> str | None:
    if not settings.langsmith_api_key:
        return None

    os.environ["LANGSMITH_TRACING"] = settings.langsmith_tracing
    os.environ["LANGSMITH_PROJECT"] = settings.langsmith_project
    os.environ["LANGSMITH_API_KEY"] = settings.langsmith_api_key
    return f"trace_{uuid4().hex[:16]}"
