import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field, field_validator

from app.actions.workflow import build_follow_up_actions
from app.answering.grounding import Answer, answer_question
from app.answering.llm import ChatModel, ChatModelError
from app.api.dependencies import get_chat_model, get_db, get_embedder, get_vector_store
from app.database import repository
from app.database.models import Contract, KeyTermRow, RiskFindingRow, RiskReview
from app.guardrails.prompt_injection import refuse_injected_question
from app.ingestion.parsing import DocumentTextError, extract_text
from app.key_terms.terms import KEY_TERMS, NOT_STATED, TERM_BY_ID
from app.ingestion.pipeline import TokenBudget, chunk_contract_text
from app.ingestion.uploads import MAX_UPLOAD_BYTES, ValidatedUpload, validate_contract_upload
from app.retrieval.embeddings import Embedder
from app.retrieval.indexing import index_contract
from app.retrieval.retriever import DEFAULT_LIMIT, retrieve_contract_context
from app.retrieval.vector_store import ChunkHit, VectorStore, VectorStoreError
from app.risk_analysis.analyzer import RiskReport, analyze_risks
from app.risk_analysis.review import run_review_in_background
from app.risk_analysis.rubric import CATEGORY_BY_ID, RISK_CATEGORIES, SEVERITIES


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["contracts"])


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1)
    # Restrict the search to one contract; omit to search every uploaded contract.
    contract_id: UUID | None = None
    limit: int = Field(DEFAULT_LIMIT, ge=1, le=20)

    @field_validator("question", mode="before")
    @classmethod
    def strip_question(cls, value: object) -> object:
        # Trim before min_length applies, so "   " is rejected like "" and the
        # retriever never sees surrounding whitespace.
        return value.strip() if isinstance(value, str) else value


class RetrievedChunk(BaseModel):
    chunk_id: UUID
    contract_id: UUID
    chunk_index: int
    text: str
    score: float

    @classmethod
    def from_hit(cls, hit: ChunkHit) -> "RetrievedChunk":
        return cls(
            chunk_id=hit.chunk_id,
            contract_id=hit.contract_id,
            chunk_index=hit.chunk_index,
            text=hit.text,
            score=hit.score,
        )


class CitedChunk(RetrievedChunk):
    # The [n] the answer text uses for this passage (MAS-13).
    label: int


class RiskFlag(BaseModel):
    # One rubric finding (MAS-15/16), quoting the passage it was found in.
    category: str
    category_name: str
    severity: str
    reason: str
    quote: str
    label: int  # the [n] of the passage among retrieved_context, 1-based
    chunk_id: UUID
    contract_id: UUID
    chunk_index: int


class QueryResponse(BaseModel):
    answer: str
    # answered | not_found | withheld. "withheld" means every retrieved
    # passage was withheld by the guardrail and the model was never asked;
    # it is a different fact from "not found" and the UI shows it as such (MAS-93).
    answer_status: str
    # False when the answer is "Not found in contract." or carries no citation.
    grounded: bool
    citations: list[CitedChunk]
    answer_model: str | None
    retrieved_context: list[RetrievedChunk]
    risks: list[RiskFlag]
    # False when the risk analysis could not be run or read for this answer.
    risks_checked: bool
    # False when some of the model's findings failed validation and were
    # dropped; the ones shown are verified, but the list may be short.
    risks_complete: bool
    recommended_actions: list[str]
    # Passage numbers (1-based, among retrieved_context) that the prompt-
    # injection guardrail withheld from the model (MAS-90). They are still
    # listed in retrieved_context so the user can read what was refused.
    blocked_passages: list[int] = []


class ContractSummary(BaseModel):
    contract_id: UUID
    filename: str
    file_type: str
    size_bytes: int
    character_count: int
    chunk_count: int
    status: str
    created_at: datetime
    # The whole-contract risk review (MAS-81): pending | running | done |
    # failed, or None for a contract uploaded before reviews existed.
    risk_status: str | None = None
    risk_worst_severity: str | None = None

    @classmethod
    def from_model(cls, contract: Contract, review: tuple[str, str | None] | None = None) -> "ContractSummary":
        return cls(
            contract_id=contract.id,
            filename=contract.filename,
            file_type=contract.file_type,
            size_bytes=contract.size_bytes,
            character_count=contract.character_count,
            chunk_count=contract.chunk_count,
            status=contract.status,
            created_at=contract.created_at,
            risk_status=review[0] if review else None,
            risk_worst_severity=review[1] if review else None,
        )


class ReviewFinding(BaseModel):
    category: str
    category_name: str
    severity: str
    reason: str
    quote: str
    chunk_id: UUID
    chunk_index: int


class ReviewCategory(BaseModel):
    id: str
    name: str
    # None when the review found nothing in this category.
    worst_severity: str | None
    findings: int


class KeyTermSource(BaseModel):
    value: str
    quote: str
    chunk_id: UUID
    chunk_index: int
    # Machine-readable value, present only when every number in it was found
    # in the quote (MAS-82 typed addition); otherwise the term is text only.
    typed: dict | None


class KeyTermValue(BaseModel):
    id: str
    name: str
    kind: str
    # found | not_stated | conflicting | unchecked. "unchecked" means the
    # key-terms pass did not complete for this contract, so absence proves
    # nothing; "not_stated" is only claimed when every passage was read.
    status: str
    value: str
    # The passage the value comes from (the earliest statement), or None.
    source: KeyTermSource | None
    # Further passages stating the same term; "conflicting" when their values differ.
    others: list[KeyTermSource]

    @classmethod
    def from_rows(cls, term_id: str, rows: list[KeyTermRow], chunk_index: dict[UUID, int], *, checked: bool) -> "KeyTermValue":
        term = TERM_BY_ID[term_id]
        sources = [
            KeyTermSource(value=r.value, quote=r.quote, chunk_id=r.chunk_id, chunk_index=chunk_index.get(r.chunk_id, 0), typed=r.typed)
            for r in rows
        ]
        if not sources:
            return cls(
                id=term.id,
                name=term.name,
                kind=term.kind,
                status="not_stated" if checked else "unchecked",
                value=NOT_STATED if checked else "Not checked",
                source=None,
                others=[],
            )
        first, others = sources[0], sources[1:]
        conflicting = any(_same_value(o, first) is False for o in others)
        return cls(
            id=term.id,
            name=term.name,
            kind=term.kind,
            status="conflicting" if conflicting else "found",
            value=first.value,
            source=first,
            others=others,
        )


def _same_value(a: KeyTermSource, b: KeyTermSource) -> bool:
    # Typed values compare exactly; text values compare loosely (case, spacing).
    if a.typed is not None and b.typed is not None:
        return a.typed == b.typed
    return " ".join(a.value.lower().split()) == " ".join(b.value.lower().split())


class KeyTermsResponse(BaseModel):
    contract_id: UUID
    # The review's status: pending | running | done | failed.
    status: str
    # True when every passage was read for key terms and every reply was usable.
    complete: bool
    chunks_total: int
    chunks_checked: int
    chunks_withheld: int
    model: str | None
    updated_at: datetime
    terms: list[KeyTermValue]

    @classmethod
    def from_models(cls, review: RiskReview, rows: list[KeyTermRow], chunk_index: dict[UUID, int]) -> "KeyTermsResponse":
        checked = review.status == "done" and review.key_terms_complete
        by_term: dict[str, list[KeyTermRow]] = {term.id: [] for term in KEY_TERMS}
        for row in rows:
            by_term.setdefault(row.term, []).append(row)
        return cls(
            contract_id=review.contract_id,
            status=review.status,
            complete=checked,
            chunks_total=review.chunks_total,
            chunks_checked=review.chunks_checked,
            chunks_withheld=review.chunks_withheld,
            model=review.model,
            updated_at=review.updated_at,
            terms=[KeyTermValue.from_rows(term.id, by_term[term.id], chunk_index, checked=checked) for term in KEY_TERMS],
        )


class RiskReviewResponse(BaseModel):
    contract_id: UUID
    status: str  # pending | running | done | failed
    model: str | None
    chunks_total: int
    chunks_checked: int
    # Passages the guardrail withheld from the model: never graded, and not
    # counted in chunks_checked (MAS-94).
    chunks_withheld: int
    # False while running, or when some passages could not be graded.
    complete: bool
    error: str | None
    updated_at: datetime
    findings: list[ReviewFinding]
    categories: list[ReviewCategory]
    # The key-terms pass of the same job (MAS-82): its terms and whether it completed.
    key_terms_complete: bool
    key_terms: list[KeyTermValue]

    @classmethod
    def from_models(
        cls, review: RiskReview, rows: list[RiskFindingRow], chunk_index: dict[UUID, int], terms: list[KeyTermRow] = ()
    ) -> "RiskReviewResponse":
        findings = [
            ReviewFinding(
                category=row.category,
                category_name=CATEGORY_BY_ID[row.category].name if row.category in CATEGORY_BY_ID else row.category,
                severity=row.severity,
                reason=row.reason,
                quote=row.quote,
                chunk_id=row.chunk_id,
                chunk_index=chunk_index.get(row.chunk_id, 0),
            )
            for row in rows
        ]
        findings.sort(key=lambda f: (-SEVERITIES.index(f.severity) if f.severity in SEVERITIES else 0, f.chunk_index))
        categories = []
        for category in RISK_CATEGORIES:
            mine = [f for f in findings if f.category == category.id]
            worst = max((f.severity for f in mine), key=SEVERITIES.index, default=None)
            categories.append(ReviewCategory(id=category.id, name=category.name, worst_severity=worst, findings=len(mine)))
        return cls(
            contract_id=review.contract_id,
            status=review.status,
            model=review.model,
            chunks_total=review.chunks_total,
            chunks_checked=review.chunks_checked,
            chunks_withheld=review.chunks_withheld,
            complete=review.complete,
            error=review.error,
            updated_at=review.updated_at,
            findings=findings,
            categories=categories,
            key_terms_complete=review.status == "done" and review.key_terms_complete,
            key_terms=KeyTermsResponse.from_models(review, list(terms), chunk_index).terms,
        )


class UploadContractResponse(ContractSummary):
    content_type: str | None
    max_size_bytes: int


@router.post("/contracts/upload", response_model=UploadContractResponse)
async def upload_contract(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: psycopg.Connection = Depends(get_db),
    embedder: Embedder = Depends(get_embedder),
    store: VectorStore = Depends(get_vector_store),
    chat_model: ChatModel = Depends(get_chat_model),
) -> UploadContractResponse:
    upload = await validate_contract_upload(file)

    # Parsing, chunking, the database write and embedding are all synchronous.
    # Running them inline would block the event loop for the whole upload — a
    # large PDF or a slow insert stalls every other request on this worker —
    # so each goes to the thread pool.
    text, chunks = await run_in_threadpool(_parse_and_chunk, upload, embedder)

    contract = await run_in_threadpool(
        repository.create_contract,
        db,
        filename=upload.filename,
        file_type=upload.file_type,
        size_bytes=upload.size_bytes,
        character_count=len(text),
        chunks=chunks,
    )

    # A contract without vectors can never be searched, so if indexing fails
    # the upload as a whole fails: remove the rows rather than leave a
    # half-processed contract that looks fine in the list.
    try:
        await run_in_threadpool(index_contract, db, contract, embedder, store)
    except Exception:
        await run_in_threadpool(_discard_failed_upload, db, store, contract.id)
        raise

    # The whole-contract risk review (MAS-81) takes one model call per batch
    # of passages; it runs after the response, and the UI polls its status.
    await run_in_threadpool(repository.start_risk_review, db, contract.id)
    # The task opens its own connection, so what it must see is committed now
    # rather than when this request's connection closes.
    await run_in_threadpool(db.commit)
    background_tasks.add_task(run_review_in_background, contract.id, chat_model)

    return UploadContractResponse(
        **ContractSummary.from_model(contract, ("pending", None)).model_dump(),
        content_type=upload.content_type,
        max_size_bytes=MAX_UPLOAD_BYTES,
    )


def _discard_failed_upload(db: psycopg.Connection, store: VectorStore, contract_id: UUID) -> None:
    """Remove what a failed upload left in Postgres and Qdrant. Runs off the loop.

    Indexing may have failed before or after Qdrant accepted the vectors, so
    both stores are cleaned. Each step is best effort: a failure here is
    logged, never raised, so the client still sees the original upload error.
    """
    try:
        # End the failed transaction first: otherwise the delete would nest
        # inside it and be rolled back along with it when the request exits.
        db.rollback()
        repository.delete_contract(db, contract_id)
    except Exception:
        logger.exception("Failed upload: could not delete contract %s from the database", contract_id)
    try:
        store.delete_contract(contract_id)
    except VectorStoreError as error:
        logger.warning("Failed upload: could not delete vectors for contract %s: %s", contract_id, error)


@router.get("/contracts", response_model=list[ContractSummary])
def list_contracts(db: psycopg.Connection = Depends(get_db)) -> list[ContractSummary]:
    reviews = repository.list_risk_summaries(db)
    return [ContractSummary.from_model(c, reviews.get(c.id)) for c in repository.list_contracts(db)]


@router.get("/contracts/{contract_id}", response_model=ContractSummary)
def get_contract(
    contract_id: UUID,
    db: psycopg.Connection = Depends(get_db),
) -> ContractSummary:
    contract = repository.get_contract(db, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return ContractSummary.from_model(contract, repository.list_risk_summaries(db).get(contract_id))


class Passage(BaseModel):
    chunk_id: UUID
    chunk_index: int
    text: str


@router.get("/contracts/{contract_id}/passages", response_model=list[Passage])
def get_contract_passages(contract_id: UUID, db: psycopg.Connection = Depends(get_db)) -> list[Passage]:
    """Every stored passage of the contract in order — the text behind each citation, finding and key term (MAS-83)."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return [Passage(chunk_id=c.id, chunk_index=c.chunk_index, text=c.chunk_text) for c in repository.list_chunks(db, contract_id)]


@router.get("/contracts/{contract_id}/risks", response_model=RiskReviewResponse)
def get_contract_risks(contract_id: UUID, db: psycopg.Connection = Depends(get_db)) -> RiskReviewResponse:
    """The whole-contract risk review: its status and the verified findings (MAS-81)."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    review = repository.get_risk_review(db, contract_id)
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This contract has not been reviewed for risks yet. Start a review to grade it.",
        )
    return _review_response(db, review)


@router.get("/contracts/{contract_id}/key-terms", response_model=KeyTermsResponse)
def get_contract_key_terms(contract_id: UUID, db: psycopg.Connection = Depends(get_db)) -> KeyTermsResponse:
    """The contract's financial key terms with their source passages (MAS-82)."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    review = repository.get_risk_review(db, contract_id)
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This contract has not been reviewed yet. Start a review to extract its key terms.",
        )
    chunk_index = {chunk.id: chunk.chunk_index for chunk in repository.list_chunks(db, contract_id)}
    return KeyTermsResponse.from_models(review, repository.list_key_terms(db, contract_id), chunk_index)


@router.post("/contracts/{contract_id}/review", response_model=RiskReviewResponse, status_code=status.HTTP_202_ACCEPTED)
def review_contract_risks(
    contract_id: UUID,
    background_tasks: BackgroundTasks,
    db: psycopg.Connection = Depends(get_db),
    chat_model: ChatModel = Depends(get_chat_model),
) -> RiskReviewResponse:
    """(Re)run the whole-contract risk review; poll GET .../risks for the result."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    current = repository.get_risk_review(db, contract_id)
    if current is not None and current.status in ("pending", "running"):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A risk review of this contract is already running.")
    review = repository.start_risk_review(db, contract_id)
    db.commit()  # the task's own connection must see the pending row
    background_tasks.add_task(run_review_in_background, contract_id, chat_model)
    return _review_response(db, review)


def _review_response(db: psycopg.Connection, review: RiskReview) -> RiskReviewResponse:
    rows = repository.list_risk_findings(db, review.contract_id)
    chunk_index = {chunk.id: chunk.chunk_index for chunk in repository.list_chunks(db, review.contract_id)}
    return RiskReviewResponse.from_models(review, rows, chunk_index, repository.list_key_terms(db, review.contract_id))


def _parse_and_chunk(upload: ValidatedUpload, embedder: Embedder) -> tuple[str, list[str]]:
    """Extract text and split it into chunks. Runs off the event loop."""
    text = _extract_or_reject(upload)
    # Chunk within the model's token limit too, so nothing is truncated when
    # the chunk is embedded (MAS-49).
    budget = TokenBudget(count=embedder.count_tokens, max_tokens=embedder.max_tokens)
    return text, chunk_contract_text(text, token_budget=budget)


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
async def query_contract(
    request: QueryRequest,
    db: psycopg.Connection = Depends(get_db),
    embedder: Embedder = Depends(get_embedder),
    store: VectorStore = Depends(get_vector_store),
    chat_model: ChatModel = Depends(get_chat_model),
) -> QueryResponse:
    # A question that is itself an injection is refused before retrieval and
    # before either model call (MAS-90); the guardrail would catch it in the
    # answer call, but the risk call runs alongside and would still be spent.
    refuse_injected_question(request.question)
    # Embedding the question is CPU work, the lookups are synchronous and the
    # model call blocks, so all of it runs off the event loop like the upload path.
    hits, answer, risks = await run_in_threadpool(_retrieve_and_answer, request, db, embedder, store, chat_model)

    return QueryResponse(
        answer=answer.text,
        answer_status=answer.status,
        grounded=answer.grounded,
        citations=[
            CitedChunk(label=citation.label, **RetrievedChunk.from_hit(citation.hit).model_dump())
            for citation in answer.citations
        ],
        answer_model=answer.model,
        retrieved_context=[RetrievedChunk.from_hit(hit) for hit in hits],
        risks=[
            RiskFlag(
                category=f.category,
                category_name=f.category_name,
                severity=f.severity,
                reason=f.reason,
                quote=f.quote,
                label=f.label,
                chunk_id=f.hit.chunk_id,
                contract_id=f.hit.contract_id,
                chunk_index=f.hit.chunk_index,
            )
            for f in risks.findings
        ],
        risks_checked=risks.checked,
        risks_complete=risks.complete,
        recommended_actions=build_follow_up_actions(risks.findings, checked=risks.checked, withheld=len(risks.blocked)),
        blocked_passages=sorted(set(answer.blocked) | set(risks.blocked)),
    )


def _retrieve_and_answer(
    request: QueryRequest,
    db: psycopg.Connection,
    embedder: Embedder,
    store: VectorStore,
    chat_model: ChatModel,
) -> tuple[list[ChunkHit], Answer, RiskReport]:
    hits = _retrieve(request, db, embedder, store)
    filenames = {}
    for contract_id in {hit.contract_id for hit in hits}:
        contract = repository.get_contract(db, contract_id)
        if contract is not None:
            filenames[contract_id] = contract.filename
    # Two independent model calls over the same passages; run them side by
    # side so the user waits for the slower one, not for both. A failure of
    # the risk call must not throw away a good answer: it is reported as
    # "analysis unavailable" (MAS-76). A failure of the answer call is still
    # the request's error.
    with ThreadPoolExecutor(max_workers=2) as pool:
        answer = pool.submit(answer_question, request.question, hits, chat_model, filenames=filenames)
        risks = pool.submit(analyze_risks, hits, chat_model, filenames=filenames)
        resolved = answer.result()
        try:
            report = risks.result()
        except ChatModelError as error:
            logger.warning("Risk analysis unavailable for %r: %s", request.question, error)
            report = RiskReport([], checked=False)
        return hits, resolved, report


def _retrieve(request: QueryRequest, db: psycopg.Connection, embedder: Embedder, store: VectorStore) -> list[ChunkHit]:
    if request.contract_id is not None and repository.get_contract(db, request.contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return retrieve_contract_context(
        request.question,
        db=db,
        embedder=embedder,
        store=store,
        contract_id=request.contract_id,
        limit=request.limit,
    )
