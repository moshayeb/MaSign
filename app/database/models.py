"""Plain records mirroring the contracts, chunks and vector_index tables."""

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
