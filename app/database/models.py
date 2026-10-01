"""Plain records mirroring the contracts, chunks, vector_index and risk tables."""

from dataclasses import dataclass, field
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class Contract:
    id: UUID
    filename: str
    file_type: str
    size_bytes: int
    character_count: int
    chunk_count: int
    status: str
    created_at: datetime
    workspace_id: UUID
    # What ingestion could not read, as sentences for the user (MAS-84).
    ingestion_notes: list[str] = field(default_factory=list)
    # contract | uncertain | not_contract, by rule (MAS-107); None until classified.
    document_kind: str | None = None
    document_looks_like: str | None = None
    document_kind_reasons: list[str] = field(default_factory=list)
    # Which embedding profiles this contract has actually been indexed into
    # (MAS-62 compare mode); "portable" always, "quality" only once its
    # best-effort indexing has actually succeeded for it.
    indexed_profiles: list[str] = field(default_factory=lambda: ["portable"])
    # Named standard profile this contract compares against (MAS-185); None
    # means "use the workspace's default profile".
    standard_profile_id: UUID | None = None


@dataclass(frozen=True)
class Chunk:
    id: UUID
    contract_id: UUID
    chunk_index: int
    chunk_text: str
    embedding_id: str | None
    created_at: datetime


@dataclass(frozen=True)
class VectorIndex:
    """Fingerprint of the embedder a Qdrant collection was built with (MAS-52).

    Vectors from two different models — or the same model with a different
    prefix scheme, token limit or backend (MAS-61) — are not comparable even
    when their dimension matches, so all of it is part of the identity.
    """

    collection: str
    backend: str
    model_name: str
    dimension: int
    max_tokens: int
    prompt_format: str


@dataclass(frozen=True)
class RiskReview:
    """Status of a contract's whole-contract risk review (MAS-81)."""

    contract_id: UUID
    status: str  # pending | running | done | failed
    model: str | None
    chunks_total: int
    chunks_checked: int
    complete: bool
    error: str | None
    updated_at: datetime
    # Passages the guardrail withheld from the model: not graded (MAS-94).
    chunks_withheld: int = 0
    # The key-terms pass (MAS-82) runs in the same job; False while running
    # or when a batch's key-terms reply was unusable.
    key_terms_complete: bool = False
    # The clause-checklist pass (MAS-188) runs in the same job too; same
    # meaning as key_terms_complete, for the clause catalog instead.
    clauses_complete: bool = False
    # Exactly which clause ids were part of the check that set
    # clauses_complete (MAS-193): the contract's standard profile can change
    # which clauses apply *after* this review ran, so a currently-enabled
    # clause missing from this list was never actually asked about, however
    # old clauses_complete claims -- it must read cannot_tell, not absent.
    checked_clause_ids: list[str] = field(default_factory=list)
    # Passage indexes (0-based) whose model reply was unreadable, and those the
    # guardrail withheld — listed, not only counted (MAS-84).
    unreadable_chunks: list["CoveragePassage"] = field(default_factory=list)
    withheld_chunks: list["CoveragePassage"] = field(default_factory=list)
    # Passages graded minus their injected sentences (MAS-99).
    redacted_chunks: list["CoveragePassage"] = field(default_factory=list)


@dataclass(frozen=True)
class RiskSummary:
    """Small review projection returned with each contract list row."""

    status: str
    worst_severity: str | None
    complete: bool
    chunks_checked: int
    chunks_total: int
    key_terms_complete: bool = False
    high_findings: int = 0


@dataclass(frozen=True)
class CoveragePassage:
    """One physical passage a review could not fully grade.

    Chunk indexes restart at zero for every uploaded document. A bundle must
    therefore keep the owning contract with the index (MAS-139).
    """

    contract_id: UUID
    chunk_index: int


@dataclass(frozen=True)
class RiskFindingRow:
    """One verified rubric finding stored for a contract (MAS-81).

    `contract_id` is the contract whose review stored this row; `source_contract_id`
    is the document the passage itself belongs to (MAS-138) -- the same
    contract for a solo review, or a bundle member's id for a bundle review.
    """

    id: UUID
    contract_id: UUID
    source_contract_id: UUID
    chunk_id: UUID
    category: str
    severity: str
    reason: str
    quote: str
    created_at: datetime


@dataclass(frozen=True)
class KeyTermRow:
    """One verified key term stored for a contract (MAS-82).

    `contract_id` is the contract whose review stored this row; `source_contract_id`
    is the document the passage itself belongs to (MAS-138) -- see `RiskFindingRow`.
    """

    id: UUID
    contract_id: UUID
    source_contract_id: UUID
    chunk_id: UUID
    term: str
    value: str
    quote: str
    typed: dict | None
    created_at: datetime


@dataclass(frozen=True)
class ClauseFindingRow:
    """One verified clause-checklist presence stored for a contract (MAS-188).

    Same shape as `KeyTermRow` minus `value`/`typed` -- a clause has no
    extracted value, only a quote proving it is there. `contract_id` is the
    contract whose review stored this row; `source_contract_id` is the
    document the passage itself belongs to (MAS-138) -- see `RiskFindingRow`.
    """

    id: UUID
    contract_id: UUID
    source_contract_id: UUID
    chunk_id: UUID
    clause_id: str
    quote: str
    created_at: datetime


@dataclass(frozen=True)
class ContractLink:
    """An uploaded contract explicitly linked as the resolution of a named
    external reference on another contract (MAS-137). Directional and one
    level deep: `linked_contract_id`'s own references are not included.
    Never created by a heuristic -- always an explicit, user-confirmed action.
    """

    id: UUID
    primary_contract_id: UUID
    linked_contract_id: UUID
    reference_name: str
    created_at: datetime


@dataclass(frozen=True)
class User:
    id: UUID
    email: str
    password_hash: str
    created_at: datetime


@dataclass(frozen=True)
class Workspace:
    """A user's personal workspace (MAS-143). Every contract, question and
    audit event belongs to exactly one; teams/sharing are future work, kept
    open by `workspace_members` being a real join table rather than a column
    on `users`."""

    id: UUID
    name: str
    created_at: datetime


@dataclass(frozen=True)
class AuditEvent:
    """An immutable record of who did what (MAS-143). `user_id` is None for a
    system-completed event (a background review finishing on its own) --
    never for one a person requested; that distinction is the point of this
    table."""

    id: UUID
    workspace_id: UUID
    user_id: UUID | None
    event_type: str
    target_type: str
    target_id: UUID | None
    metadata: dict
    created_at: datetime


@dataclass(frozen=True)
class Question:
    """A stored answer to a past question (MAS-102), so a reviewer returning
    to a contract does not repeat a call it already paid for. `contract_id`
    is None for a question asked with no scope ("all contracts"); `response`
    holds the full QueryResponse as it was sent, so a stored answer's
    citations, flags and withheld notices render without a second call.
    """

    id: UUID
    contract_id: UUID | None
    question: str
    answer: str
    answer_status: str
    grounded: bool
    model: str | None
    response: dict
    created_at: datetime
    workspace_id: UUID


@dataclass(frozen=True)
class Invoice:
    """An uploaded invoice checked against a contract (MAS-92). Never run
    through the contract pipeline -- no vector index, no risk review -- just
    enough extraction to compare its stated amounts, dates and rates."""

    id: UUID
    workspace_id: UUID
    contract_id: UUID
    filename: str
    size_bytes: int
    character_count: int
    page_count: int
    ingestion_notes: list[str]
    created_at: datetime


@dataclass(frozen=True)
class InvoiceChunk:
    """One readable page of an invoice (MAS-92). `chunk_index` is the real PDF
    page number, not a sequential position -- a page with no text layer is
    skipped, so later pages keep their true numbers for citation."""

    id: UUID
    invoice_id: UUID
    chunk_index: int
    chunk_text: str


@dataclass(frozen=True)
class InvoiceCheck:
    """One comparison run of an invoice against a contract (MAS-92). Re-checking
    the same invoice adds a new row rather than overwriting the old one, so a
    past outcome stays auditable. `checked` is false when the model's reply
    describing the invoice's fields could not be read at all."""

    id: UUID
    workspace_id: UUID
    invoice_id: UUID
    contract_id: UUID
    model: str | None
    checked: bool
    created_at: datetime


@dataclass(frozen=True)
class InvoiceCheckItem:
    """One compared item -- a fee, a due date, a late-payment rate -- with
    both sides' evidence (MAS-92). `outcome` is match | possible_mismatch |
    cannot_verify; a mismatch always carries both an invoice and a contract
    quote, and a term/field that was not found on either side is left None
    rather than guessed (honest-outcomes)."""

    id: UUID
    invoice_check_id: UUID
    label: str
    outcome: str
    reason: str
    contract_term: str | None
    contract_value: str | None
    contract_quote: str | None
    contract_chunk_id: UUID | None
    source_contract_id: UUID | None
    invoice_field: str | None
    invoice_value: str | None
    invoice_quote: str | None
    invoice_chunk_id: UUID | None
    created_at: datetime


@dataclass(frozen=True)
class StandardProfile:
    """A named set of the four MAS-120 numeric standards (MAS-185). Every
    workspace has exactly one `is_default` profile; a contract with no
    profile of its own compares against it."""

    id: UUID
    workspace_id: UUID
    name: str
    is_default: bool
    created_at: datetime
    updated_at: datetime
