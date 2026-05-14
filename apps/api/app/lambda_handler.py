from typing import Any


_handler = None


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    global _handler
    if _handler is None:
        from mangum import Mangum

        from app.main import app

        _handler = Mangum(app, lifespan="auto")
    return _handler(event, context)
