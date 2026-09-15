import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse

from app.api.routes import router as api_router
from app.database.migrations import run_migrations
from app.retrieval.embeddings import get_embedder
from app.retrieval.vector_store import VectorStoreError, get_vector_store

# Uvicorn configures only its own loggers; without this the app's startup and
# error lines (migrations, model loading, outages) never reach the container log.
logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
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

        # Load the embedding model now (first load downloads it) and make sure
        # the Qdrant collection matches its vector size, so the first upload
        # doesn't pay for either.
        embedder = get_embedder()
        embedder.warm_up()
        get_vector_store().ensure_collection(embedder.dimension)
        logger.info("Embeddings ready: %s (%d dims)", embedder.model_name, embedder.dimension)
    yield


app = FastAPI(
    title="MaSign",
    version="0.1.0",
    description="Contract ingestion, retrieval, risk analysis, and action orchestration API.",
    lifespan=lifespan,
)

app.include_router(api_router)


@app.exception_handler(RequestValidationError)
async def readable_validation_error(_: Request, error: RequestValidationError) -> JSONResponse:
    # FastAPI's default 422 puts a list of error objects in `detail`. Every
    # other error here carries a readable string that the UI shows verbatim in
    # a toast (docs/frontend.md), so give validation errors the same shape and
    # keep the structured list under `errors` for programmatic clients.
    errors = error.errors()
    messages = []
    for item in errors:
        location = ".".join(str(part) for part in item.get("loc", ()) if part not in ("body", "query", "path"))
        messages.append(f"{location}: {item['msg']}" if location else item["msg"])
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": "; ".join(messages), "errors": _jsonable(errors)},
    )


def _jsonable(errors: list[dict]) -> list[dict]:
    # pydantic error dicts can carry the offending input and an exception
    # object under `ctx`; neither is guaranteed JSON-serialisable.
    return [{k: (str(v) if k == "ctx" else v) for k, v in e.items() if k != "input"} for e in errors]


@app.exception_handler(psycopg.OperationalError)
async def database_unavailable(_: Request, error: psycopg.OperationalError) -> JSONResponse:
    # Connection-level failures (Postgres down, wrong host, auth) are an
    # operational problem, not a bad request: say so instead of a bare 500.
    logger.error("Database unavailable: %s", error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Database unavailable. Check that Postgres is running and DATABASE_URL is correct."},
    )


@app.exception_handler(VectorStoreError)
async def vector_store_unavailable(_: Request, error: VectorStoreError) -> JSONResponse:
    logger.error("Vector store unavailable: %s", error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Vector store unavailable. Check that Qdrant is running and VECTOR_STORE_URL is correct."},
    )


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # No web UI yet (MAS-17/18); send visitors to the interactive API docs.
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
