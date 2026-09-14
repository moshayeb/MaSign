import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.api.routes import router as api_router
from app.database.migrations import run_migrations

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    # Bring the schema up to date before serving. Tests run without Postgres
    # and set APP_ENV=test to skip this; a failure elsewhere should be loud,
    # because every request after this point needs the tables.
    if os.getenv("APP_ENV") != "test":
        applied = run_migrations()
        logger.info("Database ready (%d migration(s) applied)", len(applied))
    yield


app = FastAPI(
    title="MaSign",
    version="0.1.0",
    description="Contract ingestion, retrieval, risk analysis, and action orchestration API.",
    lifespan=lifespan,
)

app.include_router(api_router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # No web UI yet (MAS-17/18); send visitors to the interactive API docs.
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
