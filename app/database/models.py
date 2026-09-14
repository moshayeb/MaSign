"""Plain records mirroring the contracts and chunks tables."""

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
