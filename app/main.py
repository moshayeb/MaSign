import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.routes import router as api_router
from app.database.migrations import run_migrations

logger = logging.getLogger(__name__)

# Local runs read settings from .env (see .env.example). Real environment
# variables win, so Docker/CI configuration is never overridden by the file.
# Settings are read lazily (per request / at startup), so loading here is early enough.
load_dotenv()


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


@app.exception_handler(psycopg.OperationalError)
async def database_unavailable(_: Request, error: psycopg.OperationalError) -> JSONResponse:
    # Connection-level failures (Postgres down, wrong host, auth) are an
    # operational problem, not a bad request: say so instead of a bare 500.
    logger.error("Database unavailable: %s", error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Database unavailable. Check that Postgres is running and DATABASE_URL is correct."},
    )


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # No web UI yet (MAS-17/18); send visitors to the interactive API docs.
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
