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
    # What ingestion could not read, as sentences for the user (MAS-84).
    ingestion_notes: list[str] = field(default_factory=list)
    # contract | uncertain | not_contract, by rule (MAS-107); None until classified.
    document_kind: str | None = None
    document_looks_like: str | None = None
    document_kind_reasons: list[str] = field(default_factory=list)


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
    # Passage indexes (0-based) whose model reply was unreadable, and those the
    # guardrail withheld — listed, not only counted (MAS-84).
    unreadable_chunks: list[int] = field(default_factory=list)
    withheld_chunks: list[int] = field(default_factory=list)
    # Passages graded minus their injected sentences (MAS-99).
    redacted_chunks: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class RiskFindingRow:
    """One verified rubric finding stored for a contract (MAS-81)."""

    id: UUID
    contract_id: UUID
    chunk_id: UUID
    category: str
    severity: str
    reason: str
    quote: str
    created_at: datetime


@dataclass(frozen=True)
class KeyTermRow:
    """One verified key term stored for a contract (MAS-82)."""

    id: UUID
    contract_id: UUID
    chunk_id: UUID
    term: str
    value: str
    quote: str
    typed: dict | None
    created_at: datetime
