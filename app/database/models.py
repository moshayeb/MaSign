"""Plain records mirroring the contracts, chunks, vector_index and risk tables."""

from dataclasses import dataclass
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
