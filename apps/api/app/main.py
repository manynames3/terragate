from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from sqlalchemy import text
from uuid import uuid4
import logging
import json
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.db.init_db import init_db
from app.db.session import engine
from app.routes.terraform_reviews import router as terraform_reviews_router
from app.routes.workspace import router as workspace_router


settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    init_db()
    yield


app = FastAPI(
    title="TerraGate API",
    version="0.1.0",
    description="FastAPI backend for deterministic-first Terraform risk reviews.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["X-Request-ID"],
)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def readiness():
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        return {"status": "ready", "database": "reachable"}
    except Exception:
        return JSONResponse(status_code=503, content={"status": "unavailable", "database": "unreachable"})


@app.middleware("http")
async def request_context(request, call_next):
    trace_id = uuid4().hex
    try:
        response = await call_next(request)
    except Exception as exc:
        logging.getLogger("terragate.api").error(json.dumps({"event": "request_failed", "request_id": trace_id,
            "method": request.method, "route": getattr(request.scope.get("route"), "path", "unmatched"), "error_type": type(exc).__name__}))
        response = JSONResponse(status_code=500, content={"detail": "The request failed. Retry or contact your administrator with the trace ID.", "trace_id": trace_id})
    response.headers["X-Request-ID"] = trace_id
    return response


app.include_router(terraform_reviews_router)
app.include_router(workspace_router)
