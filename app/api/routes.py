import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from uuid import UUID

import psycopg
from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from pydantic import BaseModel, Field, field_validator

from app.actions.workflow import build_follow_up_actions
from app.api import export
from app.answering.grounding import Answer, answer_question
from app.answering.llm import ChatModel, ChatModelError
from app.api.dependencies import get_chat_model, get_db, get_embedder, get_vector_store
from app.database import repository
from app.database.models import Chunk, Contract, ContractLink, KeyTermRow, RiskFindingRow, RiskReview, RiskSummary
from app.guardrails.prompt_injection import redact_passage, refuse_injected_question
from app.ingestion.document_type import classify_document
from app.ingestion.parsing import DocumentTextError, ExtractedDocument, extract_document
from app.ingestion.references import find_external_references
from app.key_terms.deadlines import compute_deadlines
from app.key_terms.standards import STANDARDS
from app.key_terms.standards import compare as compare_to_standard
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

# Every question reaches the paid chat provider (litellm.completion()); an
# unbounded length has no cap on per-query cost. 2000 chars is generous for
# any real question and matched by the frontend's input (MAS-130).
MAX_QUESTION_LENGTH = 2000


class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=MAX_QUESTION_LENGTH)
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
    # Passages read minus their injected sentences (MAS-99): the model saw the rest.
    redacted_passages: list[int] = []


# Terms the contract-list summary strip needs (MAS-101): the two shown as
# text, plus every term with a standard, to count deviations without a
# second pass over the full key-terms table.
SUMMARY_TERM_IDS = ("recurring_fee", "initial_term", *STANDARDS.keys())


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
    risk_complete: bool | None = None
    risk_chunks_checked: int | None = None
    risk_chunks_total: int | None = None
    # What ingestion could not read (MAS-84): shown as "Not reviewed: …".
    ingestion_notes: list[str] = []
    # Is it a commercial contract at all (MAS-107)? contract | uncertain |
    # not_contract, by rule; None for a row not yet classified. `looks_like`
    # names the other document type the markers point to ("invoice").
    document_kind: str | None = None
    document_looks_like: str | None = None
    document_kind_reasons: list[str] = []
    # The list-row summary strip (MAS-101), from stored key terms — no model call.
    recurring_fee: str | None = None
    initial_term: str | None = None
    high_findings: int = 0
    deviations: int = 0
    # complete | partial | none — how much of the key-terms pass has run.
    key_terms_status: str = "none"

    @classmethod
    def from_model(
        cls, contract: Contract, review: RiskSummary | None = None, key_terms: dict[str, KeyTermRow] | None = None
    ) -> "ContractSummary":
        key_terms = key_terms or {}
        if review and review.key_terms_complete:
            key_terms_status = "complete"
        elif review and review.chunks_checked > 0:
            key_terms_status = "partial"
        else:
            key_terms_status = "none"
        deviations = sum(
            1
            for term_id in STANDARDS
            if (row := key_terms.get(term_id)) is not None and compare_to_standard(term_id, row.typed).status == "deviates"
        )
        return cls(
            contract_id=contract.id,
            filename=contract.filename,
            file_type=contract.file_type,
            size_bytes=contract.size_bytes,
            character_count=contract.character_count,
            chunk_count=contract.chunk_count,
            status=contract.status,
            created_at=contract.created_at,
            risk_status=review.status if review else None,
            risk_worst_severity=review.worst_severity if review else None,
            risk_complete=review.complete if review else None,
            risk_chunks_checked=review.chunks_checked if review else None,
            risk_chunks_total=review.chunks_total if review else None,
            ingestion_notes=list(contract.ingestion_notes),
            document_kind=contract.document_kind,
            document_looks_like=contract.document_looks_like,
            document_kind_reasons=list(contract.document_kind_reasons),
            recurring_fee=key_terms["recurring_fee"].value if "recurring_fee" in key_terms else None,
            initial_term=key_terms["initial_term"].value if "initial_term" in key_terms else None,
            high_findings=review.high_findings if review else 0,
            deviations=deviations,
            key_terms_status=key_terms_status,
        )


class ReviewFinding(BaseModel):
    category: str
    category_name: str
    severity: str
    reason: str
    quote: str
    chunk_id: UUID
    chunk_index: int
    # The document the passage itself belongs to (MAS-138: a bundle review's
    # findings can come from more than one contract). The frontend resolves
    # this to a filename from the already-loaded contract list, the same
    # pattern used for cross-contract citations (AnswerView.tsx).
    contract_id: UUID


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
    # The document the passage itself belongs to (MAS-138: a bundle review's
    # key terms can come from more than one contract).
    contract_id: UUID
    # Machine-readable value, present only when every number in it was found
    # in the quote (MAS-82 typed addition); otherwise the term is text only.
    typed: dict | None


class StandardVerdict(BaseModel):
    # meets | deviates | unknown (stated, but no comparable typed value) | none (no standard for this term)
    status: str
    standard: str | None = None
    detail: str | None = None


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
    # The Customer's default position for this term, compared by rule over the typed value (MAS-96).
    standard: StandardVerdict

    @classmethod
    def from_rows(cls, term_id: str, rows: list[KeyTermRow], chunk_index: dict[UUID, int], *, checked: bool) -> "KeyTermValue":
        term = TERM_BY_ID[term_id]
        sources = [
            KeyTermSource(
                value=r.value,
                quote=r.quote,
                chunk_id=r.chunk_id,
                chunk_index=chunk_index.get(r.chunk_id, 0),
                contract_id=r.source_contract_id,
                typed=r.typed,
            )
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
                standard=StandardVerdict(status="none"),
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
            standard=StandardVerdict(**compare_to_standard(term.id, first.typed).__dict__),
        )


def _same_value(a: KeyTermSource, b: KeyTermSource) -> bool:
    # Typed values compare exactly; text values compare loosely (case, spacing).
    if a.typed is not None and b.typed is not None:
        return a.typed == b.typed
    return " ".join(a.value.lower().split()) == " ".join(b.value.lower().split())


class ExternalReferenceOut(BaseModel):
    name: str
    passages: list["CoveragePassageOut"]


class CoveragePassageOut(BaseModel):
    """A passage location with its document identity (MAS-139)."""

    contract_id: UUID
    filename: str
    chunk_index: int


class ResolvedReferenceOut(BaseModel):
    """An explicit contract link; never an inferred filename match."""

    reference_name: str
    linked_contract_id: UUID
    linked_contract_filename: str


class Coverage(BaseModel):
    """What was and was not read (MAS-84) — part of every review result."""

    chunks_total: int
    chunks_checked: int
    # Passage indexes (0-based) whose model reply was unreadable: not graded; read them by hand.
    unreadable_passages: list[CoveragePassageOut]
    # Passage indexes the guardrail withheld: not graded.
    withheld_passages: list[CoveragePassageOut]
    # Passage indexes graded minus their injected sentences (MAS-99).
    redacted_passages: list[CoveragePassageOut]
    # What ingestion could not read at all (no text layer, characters removed).
    ingestion_notes: list[str]
    # Documents the text depends on that are not part of the upload.
    external_references: list[ExternalReferenceOut]
    resolved_references: list[ResolvedReferenceOut] = []
    # Whether the file reads as a commercial contract at all (MAS-107): the
    # rubric's verdicts mean little on an invoice.
    document_kind: str | None = None
    document_looks_like: str | None = None
    document_kind_reasons: list[str] = []

    @classmethod
    def build(
        cls,
        review: RiskReview,
        contract: Contract,
        bundle_chunks: list[Chunk],
        links: list[ContractLink],
        contracts: dict[UUID, Contract],
    ) -> "Coverage":
        def location(contract_id: UUID, chunk_index: int) -> CoveragePassageOut:
            # A malformed legacy row must not make an otherwise readable
            # review endpoint fail. New rows always name a bundle member.
            owner = contracts.get(contract_id, contract)
            return CoveragePassageOut(contract_id=contract_id, filename=owner.filename, chunk_index=chunk_index)

        # The detector returns indexes into the supplied chunk list. Map them
        # back to physical documents before exposing coverage to a bundle.
        references = find_external_references([chunk.chunk_text for chunk in bundle_chunks])
        resolved = {link.reference_name: link for link in links}
        return cls(
            document_kind=contract.document_kind,
            document_looks_like=contract.document_looks_like,
            document_kind_reasons=list(contract.document_kind_reasons),
            chunks_total=review.chunks_total,
            chunks_checked=review.chunks_checked,
            unreadable_passages=[location(p.contract_id, p.chunk_index) for p in review.unreadable_chunks],
            withheld_passages=[location(p.contract_id, p.chunk_index) for p in review.withheld_chunks],
            redacted_passages=[location(p.contract_id, p.chunk_index) for p in review.redacted_chunks],
            ingestion_notes=list(contract.ingestion_notes),
            external_references=[
                ExternalReferenceOut(name=r.name, passages=[location(bundle_chunks[i].contract_id, bundle_chunks[i].chunk_index) for i in r.chunk_indexes])
                for r in references
                if r.name not in resolved
            ],
            resolved_references=[
                ResolvedReferenceOut(
                    reference_name=link.reference_name,
                    linked_contract_id=link.linked_contract_id,
                    linked_contract_filename=contracts[link.linked_contract_id].filename,
                )
                for link in links
                if link.linked_contract_id in contracts
            ],
        )


class DeadlineOut(BaseModel):
    id: str
    name: str
    date: date | None
    computed_from: list[str]
    reason: str | None = None
    how: str | None = None


def _deadlines(terms: list["KeyTermValue"]) -> list[DeadlineOut]:
    typed = {t.id: (t.source.typed if t.source else None) for t in terms}
    stated = {t.id for t in terms if t.source}
    return [
        DeadlineOut(id=d.id, name=d.name, date=d.date, computed_from=list(d.computed_from), reason=d.reason, how=d.how)
        for d in compute_deadlines(typed, stated)
    ]


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
    # How many stated terms deviate from the Customer's standard (MAS-96).
    deviations: int = 0
    # Dates that follow from the typed terms (MAS-100).
    deadlines: list[DeadlineOut] = []
    coverage: Coverage | None = None

    @classmethod
    def from_models(
        cls, review: RiskReview, rows: list[KeyTermRow], chunk_index: dict[UUID, int], coverage: Coverage | None = None
    ) -> "KeyTermsResponse":
        checked = review.status == "done" and review.key_terms_complete
        by_term: dict[str, list[KeyTermRow]] = {term.id: [] for term in KEY_TERMS}
        for row in rows:
            by_term.setdefault(row.term, []).append(row)
        terms = [KeyTermValue.from_rows(term.id, by_term[term.id], chunk_index, checked=checked) for term in KEY_TERMS]
        return cls(
            contract_id=review.contract_id,
            status=review.status,
            complete=checked,
            chunks_total=review.chunks_total,
            chunks_checked=review.chunks_checked,
            chunks_withheld=review.chunks_withheld,
            model=review.model,
            updated_at=review.updated_at,
            terms=terms,
            deviations=sum(1 for t in terms if t.standard.status == "deviates"),
            deadlines=_deadlines(terms),
            coverage=coverage,
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
    deadlines: list[DeadlineOut] = []
    # What was and was not read (MAS-84).
    coverage: Coverage | None = None

    @classmethod
    def from_models(
        cls,
        review: RiskReview,
        rows: list[RiskFindingRow],
        chunk_index: dict[UUID, int],
        terms: list[KeyTermRow] = (),
        coverage: Coverage | None = None,
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
                contract_id=row.source_contract_id,
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
            key_terms=(key_terms := KeyTermsResponse.from_models(review, list(terms), chunk_index)).terms,
            deadlines=key_terms.deadlines,
            coverage=coverage,
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
    document, chunks = await run_in_threadpool(_parse_and_chunk, upload, embedder)
    text = document.text

    contract = await run_in_threadpool(
        repository.create_contract,
        db,
        filename=upload.filename,
        file_type=upload.file_type,
        size_bytes=upload.size_bytes,
        character_count=len(text),
        chunks=chunks,
        ingestion_notes=document.notes,
        # By rule, no model call: is this a contract at all (MAS-107)? Nothing is blocked on it.
        document_kind=classify_document(text),
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
        **ContractSummary.from_model(
            contract,
            RiskSummary("pending", None, False, 0, contract.chunk_count),
        ).model_dump(),
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
    key_terms = repository.list_key_terms_for(db, SUMMARY_TERM_IDS)
    return [ContractSummary.from_model(c, reviews.get(c.id), key_terms.get(c.id)) for c in repository.list_contracts(db)]


@router.get("/contracts/{contract_id}", response_model=ContractSummary)
def get_contract(
    contract_id: UUID,
    db: psycopg.Connection = Depends(get_db),
) -> ContractSummary:
    contract = repository.get_contract(db, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    key_terms = repository.list_key_terms_for(db, SUMMARY_TERM_IDS).get(contract_id)
    return ContractSummary.from_model(contract, repository.list_risk_summaries(db).get(contract_id), key_terms)


class LinkContractRequest(BaseModel):
    linked_contract_id: UUID
    # The exact external reference this link resolves (must match one of the
    # primary's current, unresolved references -- never inferred).
    reference_name: str


class ContractLinkOut(BaseModel):
    id: UUID
    primary_contract_id: UUID
    linked_contract_id: UUID
    reference_name: str
    created_at: datetime

    @classmethod
    def from_model(cls, link: ContractLink) -> "ContractLinkOut":
        return cls(
            id=link.id,
            primary_contract_id=link.primary_contract_id,
            linked_contract_id=link.linked_contract_id,
            reference_name=link.reference_name,
            created_at=link.created_at,
        )


@router.get("/contracts/{contract_id}/links", response_model=list[ContractLinkOut])
def list_contract_links(contract_id: UUID, db: psycopg.Connection = Depends(get_db)) -> list[ContractLinkOut]:
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    return [ContractLinkOut.from_model(link) for link in repository.list_links(db, contract_id)]


@router.post("/contracts/{contract_id}/links", response_model=ContractLinkOut, status_code=status.HTTP_201_CREATED)
def link_contract(
    contract_id: UUID, body: LinkContractRequest, db: psycopg.Connection = Depends(get_db)
) -> ContractLinkOut:
    """Link an uploaded contract as the resolution of a named reference (MAS-137).

    Always an explicit, user-confirmed action: `reference_name` must match one
    of the primary's current, unresolved external references (MAS-84) -- this
    never infers a match from filename or content.
    """
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    if body.linked_contract_id == contract_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="A contract cannot be linked to itself.")
    if repository.get_contract(db, body.linked_contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="The document to link was not found.")

    chunks = repository.list_chunks(db, contract_id)
    unresolved = {r.name for r in find_external_references([c.chunk_text for c in chunks])} - {
        link.reference_name for link in repository.list_links(db, contract_id)
    }
    if body.reference_name not in unresolved:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f'"{body.reference_name}" is not an unresolved reference on this contract.',
        )

    link = repository.create_link(
        db, primary_contract_id=contract_id, linked_contract_id=body.linked_contract_id, reference_name=body.reference_name
    )
    return ContractLinkOut.from_model(link)


@router.delete("/contracts/{contract_id}/links/{link_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_contract(contract_id: UUID, link_id: UUID, db: psycopg.Connection = Depends(get_db)) -> Response:
    links = repository.list_links(db, contract_id)
    if not any(link.id == link_id for link in links):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Link not found.")
    repository.delete_link(db, link_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


class Passage(BaseModel):
    chunk_id: UUID
    chunk_index: int
    text: str
    # (start, end) of every sentence the guardrail withholds from the model (MAS-99),
    # so the reader can show exactly what was hidden.
    withheld_spans: list[list[int]] = []


@router.get("/contracts/{contract_id}/passages", response_model=list[Passage])
def get_contract_passages(contract_id: UUID, db: psycopg.Connection = Depends(get_db)) -> list[Passage]:
    """Every stored passage of the contract in order — the text behind each citation, finding and key term (MAS-83)."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    passages = []
    for c in repository.list_chunks(db, contract_id):
        redaction = redact_passage(c.chunk_text)
        spans = [list(span) for span in redaction.spans] if redaction else []
        passages.append(Passage(chunk_id=c.id, chunk_index=c.chunk_index, text=c.chunk_text, withheld_spans=spans))
    return passages


@router.get("/contracts/{contract_id}/search", response_model=list[RetrievedChunk])
def search_contract(
    contract_id: UUID,
    q: str = Query(min_length=1, max_length=2000),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=20),
    db: psycopg.Connection = Depends(get_db),
    embedder: Embedder = Depends(get_embedder),
    store: VectorStore = Depends(get_vector_store),
) -> list[RetrievedChunk]:
    """Retrieval only — the passages a question would be answered from, best first. No model call (MAS-91)."""
    if repository.get_contract(db, contract_id) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    hits = retrieve_contract_context(q, db=db, embedder=embedder, store=store, contract_id=contract_id, limit=limit)
    return [RetrievedChunk.from_hit(hit) for hit in hits]


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
    contract = repository.get_contract(db, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    review = repository.get_risk_review(db, contract_id)
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This contract has not been reviewed yet. Start a review to extract its key terms.",
        )
    # See _review_response: a bundle's key terms can source a linked
    # document's own chunks, so passage numbers resolve over the bundle.
    chunk_index = {
        c.id: c.chunk_index for cid in repository.bundle_contract_ids(db, contract_id) for c in repository.list_chunks(db, cid)
    }
    coverage = _coverage_for_review(db, review, contract)
    return KeyTermsResponse.from_models(review, repository.list_key_terms(db, contract_id), chunk_index, coverage)


@router.get("/contracts/{contract_id}/export.{fmt}")
def export_contract_review(contract_id: UUID, fmt: str, db: psycopg.Connection = Depends(get_db)) -> Response:
    """The review as a file: `export.md` (Markdown) or `export.csv`. Same data as /risks and /key-terms (MAS-97)."""
    if fmt not in ("md", "csv"):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Export format must be md or csv.")
    contract = repository.get_contract(db, contract_id)
    if contract is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contract not found.")
    review = repository.get_risk_review(db, contract_id)
    if review is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This contract has not been reviewed yet. Start a review before exporting it.",
        )
    review_body = _review_response(db, review)
    # See _review_response: resolve passage numbers over the whole bundle.
    chunk_index = {
        c.id: c.chunk_index for cid in repository.bundle_contract_ids(db, contract_id) for c in repository.list_chunks(db, cid)
    }
    terms_body = KeyTermsResponse.from_models(review, repository.list_key_terms(db, contract_id), chunk_index, review_body.coverage)
    documents = {
        item.id: item.filename
        for bundle_id in repository.bundle_contract_ids(db, contract_id)
        if (item := repository.get_contract(db, bundle_id)) is not None
    }
    if fmt == "md":
        text, media = export.render_markdown(contract.filename, review_body, terms_body, documents), "text/markdown; charset=utf-8"
    else:
        text, media = export.render_csv(review_body, terms_body, documents), "text/csv; charset=utf-8"
    return Response(
        content=text,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{export.safe_filename(contract.filename, fmt)}"'},
    )


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
    review = repository.claim_risk_review(db, contract_id)
    if review is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A risk review of this contract is already running.")
    db.commit()  # the task's own connection must see the pending row
    background_tasks.add_task(run_review_in_background, contract_id, chat_model)
    return _review_response(db, review)


def _review_response(db: psycopg.Connection, review: RiskReview) -> RiskReviewResponse:
    rows = repository.list_risk_findings(db, review.contract_id)
    # A bundle review's findings/terms can point at a linked document's own
    # chunks (MAS-138); resolve passage numbers over the whole bundle so
    # those never silently fall back to "passage 1" (chunk_index.get default).
    chunk_index = {
        c.id: c.chunk_index for cid in repository.bundle_contract_ids(db, review.contract_id) for c in repository.list_chunks(db, cid)
    }
    contract = repository.get_contract(db, review.contract_id)
    coverage = _coverage_for_review(db, review, contract) if contract else None
    return RiskReviewResponse.from_models(review, rows, chunk_index, repository.list_key_terms(db, review.contract_id), coverage)


def _coverage_for_review(db: psycopg.Connection, review: RiskReview, contract: Contract) -> Coverage:
    """Build coverage from every document that the review actually read."""
    bundle_ids = repository.bundle_contract_ids(db, review.contract_id)
    contracts = {contract_id: item for contract_id in bundle_ids if (item := repository.get_contract(db, contract_id)) is not None}
    chunks = [chunk for contract_id in bundle_ids for chunk in repository.list_chunks(db, contract_id)]
    return Coverage.build(review, contract, chunks, repository.list_links(db, review.contract_id), contracts)


def _parse_and_chunk(upload: ValidatedUpload, embedder: Embedder) -> tuple[ExtractedDocument, list[str]]:
    """Extract text and split it into chunks. Runs off the event loop."""
    document = _extract_or_reject(upload)
    # Chunk within the model's token limit too, so nothing is truncated when
    # the chunk is embedded (MAS-49).
    budget = TokenBudget(count=embedder.count_tokens, max_tokens=embedder.max_tokens)
    return document, chunk_contract_text(document.text, token_budget=budget)


def _extract_or_reject(upload: ValidatedUpload) -> ExtractedDocument:
    """Parse a validated upload, or turn the failure into a clear 422.

    Validation only proves the bytes look like a supported type. A scanned
    contract is a structurally valid PDF and passes that check, but has no text
    layer to read — so the caller needs to be told the document is unusable
    rather than receiving an empty result.
    """
    try:
        return extract_document(upload.content, upload.file_type)
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
        redacted_passages=sorted(set(answer.redacted) | set(risks.redacted)),
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
    # A contract's bundle (MAS-137/138) is itself plus any linked documents;
    # a contract with no links is a bundle of one, same search as before.
    bundle_ids = repository.bundle_contract_ids(db, request.contract_id) if request.contract_id is not None else None
    return retrieve_contract_context(
        request.question,
        db=db,
        embedder=embedder,
        store=store,
        contract_ids=bundle_ids,
        limit=request.limit,
    )
