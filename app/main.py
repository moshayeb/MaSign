from fastapi import FastAPI
from fastapi.responses import RedirectResponse

from app.api.routes import router as api_router


app = FastAPI(
    title="MaSign",
    version="0.1.0",
    description="Contract ingestion, retrieval, risk analysis, and action orchestration API.",
)

app.include_router(api_router)


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    # No web UI yet (MAS-17/18); send visitors to the interactive API docs.
    return RedirectResponse(url="/docs")


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}
