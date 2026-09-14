from fastapi import APIRouter, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from app.actions.workflow import build_follow_up_actions
from app.ingestion.parsing import DocumentTextError, extract_text
from app.ingestion.pipeline import chunk_contract_text
from app.ingestion.uploads import MAX_UPLOAD_BYTES, ValidatedUpload, validate_contract_upload
from app.retrieval.retriever import retrieve_contract_context
from app.risk_analysis.analyzer import analyze_contract_risks


router = APIRouter(prefix="/api", tags=["contracts"])


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    contract_id: str | None = None


class QueryResponse(BaseModel):
    answer: str
    retrieved_context: list[str]
    risks: list[str]
    recommended_actions: list[str]


class UploadContractResponse(BaseModel):
    filename: str
    file_type: str
    content_type: str | None
    size_bytes: int
    max_size_bytes: int
    status: str
    character_count: int
    chunk_count: int


@router.post("/contracts/upload", response_model=UploadContractResponse)
async def upload_contract(file: UploadFile = File(...)) -> UploadContractResponse:
    upload = await validate_contract_upload(file)

    # Parsing and chunking are synchronous CPU work. Running them inline would
    # block the event loop for the whole upload — a large PDF stalls every other
    # request on this worker — so they go to the thread pool together.
    text, chunks = await run_in_threadpool(_parse_and_chunk, upload)

    return UploadContractResponse(
        filename=upload.filename,
        file_type=upload.file_type,
        content_type=upload.content_type,
        size_bytes=upload.size_bytes,
        max_size_bytes=MAX_UPLOAD_BYTES,
        status="processed",
        character_count=len(text),
        chunk_count=len(chunks),
    )


def _parse_and_chunk(upload: ValidatedUpload) -> tuple[str, list[str]]:
    """Extract text and split it into chunks. Runs off the event loop."""
    text = _extract_or_reject(upload)
    return text, chunk_contract_text(text)


def _extract_or_reject(upload: ValidatedUpload) -> str:
    """Parse a validated upload, or turn the failure into a clear 422.

    Validation only proves the bytes look like a supported type. A scanned
    contract is a structurally valid PDF and passes that check, but has no text
    layer to read — so the caller needs to be told the document is unusable
    rather than receiving an empty result.
    """
    try:
        return extract_text(upload.content, upload.file_type)
    except DocumentTextError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(error),
        ) from error


@router.post("/query", response_model=QueryResponse)
def query_contract(request: QueryRequest) -> QueryResponse:
    context = retrieve_contract_context(
        question=request.question,
        contract_id=request.contract_id,
    )
    risks = analyze_contract_risks(context)
    actions = build_follow_up_actions(risks)

    return QueryResponse(
        answer="This scaffold found relevant context and prepared review items.",
        retrieved_context=context,
        risks=risks,
        recommended_actions=actions,
    )
