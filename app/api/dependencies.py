from collections.abc import Iterator

import psycopg

from app.answering import llm
from app.database.session import get_connection
from app.retrieval import embeddings, vector_store


def get_db() -> Iterator[psycopg.Connection]:
    """One connection per request, committed when the handler returns."""
    with get_connection() as connection:
        yield connection


def get_embedder() -> embeddings.Embedder:
    return embeddings.get_embedder()


def get_vector_store() -> vector_store.VectorStore:
    return vector_store.get_vector_store()


def get_chat_model() -> llm.ChatModel:
    return llm.get_chat_model()
