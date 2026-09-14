from datetime import datetime
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from app.actions.workflow import build_follow_up_actions
from app.api.dependencies import get_db
from app.database import repository
from app.database.models import Contract
from app.ingestion.parsing import DocumentTextError, extract_text
from app.ingestion.pipeline import chunk_contract_text
from app.ingestion.uploads import MAX_UPLOAD_BYTES, ValidatedUpload, validate_contract_upload
from app.retrieval.retriever import retrieve_contract_context
from app.risk_analysis.analyzer import analyze_contract_risks


router = APIRouter(prefix="/api", tags=["contracts"])


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    contract_id: str | None = None

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        # Trim before min_length applies, so "   " is rejected like "" and the
        # retriever never sees surrounding whitespace.
        return value.strip() if isinstance(value, str) else value


class QueryResponse(BaseModel):
    answer: str
    retrieved_context: list[str]
    risks: list[str]
    recommended_actions: list[str]


class ContractSummary(BaseModel):
    contract_id: UUID
    filename: str
    file_type: str
    size_bytes: int
    character_count: int
    chunk_count: int
    status: str
    created_at: datetime

    @classmethod
    def from_model(cls, contract: Contract) -> "ContractSummary":
        return cls(
            contract_id=contract.id,
            filename=contract.filename,
            file_type=contract.file_type,
            size_bytes=contract.size_bytes,
            character_count=contract.character_count,
            chunk_count=contract.chunk_count,
            status=contract.status,
            created_at=contract.created_at,
        )


class UploadContractResponse(ContractSummary):
    content_type: str | None
    max_size_bytes: int


@router.post("/contracts/upload", response_model=UploadContractResponse)
async def upload_contract(
    file: UploadFile = File(...),
    db: psycopg.Connection = Depends(get_db),
) -> UploadContractResponse:
    upload = await validate_contract_upload(file)

    # Parsing and chunking are synchronous CPU work. Running them inline would
    # block the event loop for the whole upload — a large PDF stalls every other
    # request on this worker — so they go to the thread pool together.
    text, chunks = await run_in_threadpool(_parse_and_chunk, upload)

    contract = repository.create_contract(
        db,
        filename=upload.filename,
        file_type=upload.file_type,
        size_bytes=upload.size_bytes,
        character_count=len(text),
        chunks=chunks,
    )

    return UploadContractResponse(
        **ContractSummary.from_model(contract).model_dump(),
        content_type=upload.content_type,
        max_size_bytes=MAX_UPLOAD_BYTES,
    )


@router.get("/contracts", response_model=list[ContractSummary])
def list_contracts(db: psycopg.Connection = Depends(get_db)) -> list[ContractSummary]:
    return [ContractSummary.from_model(c) for c in repository.list_contracts(db)]


@router.get("/contracts/{contract_id}", response_model=ContractSummary)
def get_contract(
    contract_id: UUID,
    db: psycopg.Connection = Depends(get_db),
) -> ContractSummary:
    contract = repository.get_contract(db, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return ContractSummary.from_model(contract)


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
