from __future__ import annotations

import os
import socket
import time
from datetime import datetime, timezone

from sqlalchemy import select

from app.config import get_settings
from app.db.init_db import init_db
from app.db.session import SessionLocal
from app.models import ReviewJobModel, RunModel
from app.routes.terraform_reviews import _execute_review_job


def main() -> None:
    settings = get_settings()
    init_db()
    worker_id = f"{socket.gethostname()}:{os.getpid()}"
    once = os.getenv("WORKER_ONCE", "").lower() in {"1", "true", "yes"}
    while True:
        claimed = _claim_jobs(worker_id, settings.worker_batch_size)
        for job in claimed:
            _execute_review_job(job.run_id, job.payload or {})
        if once:
            break
        time.sleep(settings.worker_poll_interval_seconds)


def _claim_jobs(worker_id: str, batch_size: int) -> list[ReviewJobModel]:
    with SessionLocal() as db:
        jobs = db.scalars(
            select(ReviewJobModel)
            .join(RunModel)
            .where(ReviewJobModel.status == "queued")
            .where(RunModel.status == "queued")
            .order_by(ReviewJobModel.queued_at.asc())
            .limit(batch_size)
        ).all()
        claimed: list[ReviewJobModel] = []
        for job in jobs:
            job.status = "claimed"
            job.claimed_at = datetime.now(timezone.utc)
            job.worker_id = worker_id
            db.add(job)
            claimed.append(job)
        db.commit()
        for job in claimed:
            db.refresh(job)
        return claimed


if __name__ == "__main__":
    main()
