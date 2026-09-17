import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles

from app.answering.llm import ChatModelError, get_chat_model
from app.guardrails.prompt_injection import PromptInjectionError
from app.api.routes import router as api_router
from app.database.migrations import run_migrations
from app.database.session import get_connection
from app.retrieval.embeddings import EmbeddingServiceError, get_embedder
from app.retrieval.indexing import ensure_index_current
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

        # Load the embedding model now (first load downloads it; the HTTP
        # backend contacts its service) and make sure the Qdrant collection
        # was built by this very embedder — rebuilding it from the stored
        # chunks if not — so the first upload or query doesn't pay for either.
        # An unreachable embedding service is fatal here: nothing can be
        # indexed or queried without it.
        embedder = get_embedder()
        try:
            embedder.warm_up()
        except EmbeddingServiceError as error:
            logger.error("Cannot start: %s", error)
            raise
        with get_connection() as db:
            ensure_index_current(db, embedder, get_vector_store())
        logger.info("Embeddings ready: %s (%d dims)", embedder.model_name, embedder.dimension)
        # Only reads the configuration (and warns if no API key is set); the
        # first real call to the model happens on the first question.
        get_chat_model()
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


@app.exception_handler(EmbeddingServiceError)
async def embedding_service_unavailable(_: Request, error: EmbeddingServiceError) -> JSONResponse:
    logger.error("Embedding service unavailable: %s", error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": "Embedding service unavailable. Check that the server behind EMBEDDING_API_URL is running."},
    )


@app.exception_handler(PromptInjectionError)
async def prompt_injection_refused(_: Request, error: PromptInjectionError) -> JSONResponse:
    # The guardrail refused to forward the user's own message (MAS-90); the
    # reason names the pattern so the message can be reworded.
    logger.warning("Prompt injection refused: %s", error)
    return JSONResponse(status_code=status.HTTP_400_BAD_REQUEST, content={"detail": str(error)})


@app.exception_handler(ChatModelError)
async def chat_model_unavailable(_: Request, error: ChatModelError) -> JSONResponse:
    # The reason varies (no key, rate limit, provider down) and is what the
    # user needs to see, so unlike the other 503s the message is passed on.
    logger.error("Answer generation unavailable: %s", error)
    return JSONResponse(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        content={"detail": f"Answer generation unavailable: {error}"},
    )


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


# The built React app (frontend/dist, MAS-17) is served from the root when it
# exists — the Docker image builds it in; a bare API checkout (or the tests)
# has no dist, and then visitors are sent to the interactive API docs instead.
# Mounted last so /api, /health and /docs keep winning.
FRONTEND_DIST = Path(os.getenv("FRONTEND_DIST", Path(__file__).resolve().parent.parent / "frontend" / "dist"))

if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
else:

    @app.get("/", include_in_schema=False)
    def root() -> RedirectResponse:
        return RedirectResponse(url="/docs")
