"""Chunk vectors in Qdrant.

One collection holds every contract's chunks; each point's id is the chunk's
Postgres UUID, so `chunks.embedding_id` and the Qdrant point are the same key.
The payload carries enough (contract id, index, text) to build an answer
without a round trip to Postgres.
"""

import logging
from collections.abc import Iterable
import os
from dataclasses import dataclass
from functools import lru_cache
from uuid import UUID

from qdrant_client import QdrantClient
from qdrant_client.http.exceptions import ResponseHandlingException, UnexpectedResponse
from qdrant_client.models import (
    Distance,
    FieldCondition,
    Filter,
    FilterSelector,
    MatchAny,
    MatchValue,
    PointStruct,
    VectorParams,
)

logger = logging.getLogger(__name__)

DEFAULT_COLLECTION = "contract_chunks"


class VectorStoreError(RuntimeError):
    """Qdrant could not be reached or refused the request."""


@dataclass(frozen=True)
class ChunkVector:
    chunk_id: UUID
    contract_id: UUID
    chunk_index: int
    text: str
    vector: list[float]


@dataclass(frozen=True)
class ChunkHit:
    chunk_id: UUID
    contract_id: UUID
    chunk_index: int
    text: str
    score: float


class VectorStore:
    def __init__(self, client: QdrantClient, collection: str = DEFAULT_COLLECTION) -> None:
        self._client = client
        self.collection = collection

    def ping(self) -> None:
        """Raise VectorStoreError unless Qdrant answers (readiness, MAS-88)."""
        try:
            self._client.get_collections()
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

    def matches(self, dimension: int) -> bool:
        """Whether the collection exists with this vector size. Read-only."""
        try:
            if not self._client.collection_exists(self.collection):
                return False
            return self._client.get_collection(self.collection).config.params.vectors.size == dimension
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

    def ensure_collection(self, dimension: int) -> bool:
        """Create the collection, or rebuild it if the vector size changed.

        A size change means EMBEDDING_MODEL changed; old vectors are useless
        to the new model, so dropping them (and re-indexing) is the only
        sensible outcome. Returns True if the collection is new or was rebuilt,
        i.e. it is empty and needs indexing.
        """
        if self.matches(dimension):
            return False
        try:
            if self._client.collection_exists(self.collection):
                current = self._client.get_collection(self.collection).config.params.vectors.size
                logger.warning(
                    "Rebuilding collection %s: vector size %d -> %d (embedding model changed)",
                    self.collection, current, dimension,
                )
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error
        self.reset_collection(dimension)
        return True

    def reset_collection(self, dimension: int) -> None:
        """Drop the collection (if any) and create it empty with this vector size."""
        try:
            if self._client.collection_exists(self.collection):
                self._client.delete_collection(self.collection)
            self._client.create_collection(
                self.collection,
                vectors_config=VectorParams(size=dimension, distance=Distance.COSINE),
            )
            self._client.create_payload_index(self.collection, "contract_id", field_schema="keyword")
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

    def upsert(self, vectors: list[ChunkVector]) -> None:
        if not vectors:
            return
        points = [
            PointStruct(
                id=str(v.chunk_id),
                vector=v.vector,
                payload={"contract_id": str(v.contract_id), "chunk_index": v.chunk_index, "text": v.text},
            )
            for v in vectors
        ]
        try:
            self._client.upsert(self.collection, points=points, wait=True)
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

    def search(
        self,
        vector: list[float],
        *,
        contract_id: UUID | None = None,
        contract_ids: Iterable[UUID] | None = None,
        limit: int = 5,
    ) -> list[ChunkHit]:
        """Nearest chunks, best first; restricted to one contract or to a set of them.

        `contract_ids` lets the caller exclude points of contracts that no
        longer exist *before* the top-`limit` cut, so leftovers cannot crowd
        out real results (MAS-60).
        """
        query_filter = None
        if contract_id is not None:
            query_filter = Filter(must=[FieldCondition(key="contract_id", match=MatchValue(value=str(contract_id)))])
        elif contract_ids is not None:
            allowed = [str(c) for c in contract_ids]
            query_filter = Filter(must=[FieldCondition(key="contract_id", match=MatchAny(any=allowed))])
        try:
            response = self._client.query_points(
                self.collection, query=vector, query_filter=query_filter, limit=limit, with_payload=True
            )
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

        return [
            ChunkHit(
                chunk_id=UUID(str(point.id)),
                contract_id=UUID(point.payload["contract_id"]),
                chunk_index=point.payload["chunk_index"],
                text=point.payload["text"],
                score=point.score,
            )
            for point in response.points
        ]

    def delete_contract(self, contract_id: UUID) -> None:
        selector = FilterSelector(
            filter=Filter(must=[FieldCondition(key="contract_id", match=MatchValue(value=str(contract_id)))])
        )
        try:
            self._client.delete(self.collection, points_selector=selector, wait=True)
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error

    def count(self, contract_id: UUID | None = None) -> int:
        count_filter = None
        if contract_id is not None:
            count_filter = Filter(must=[FieldCondition(key="contract_id", match=MatchValue(value=str(contract_id)))])
        try:
            return self._client.count(self.collection, count_filter=count_filter, exact=True).count
        except (ResponseHandlingException, UnexpectedResponse) as error:
            raise VectorStoreError(str(error)) from error


def get_vector_store_url() -> str:
    return os.getenv("VECTOR_STORE_URL", "http://localhost:6333")


@lru_cache(maxsize=1)
def get_vector_store() -> VectorStore:
    client = QdrantClient(url=get_vector_store_url(), timeout=30)
    return VectorStore(client, collection=os.getenv("QDRANT_COLLECTION", DEFAULT_COLLECTION))
