"""Turn contract text into vectors.

The model is chosen by EMBEDDING_MODEL (see CLAUDE.md for why the default is a
legal-fine-tuned ModernBERT). Everything else in the app talks to the
`Embedder` protocol, so tests substitute a fake and a model swap is config.
"""

import logging
import os
from functools import lru_cache
from typing import Protocol

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODEL = "freelawproject/modernbert-embed-base_finetune_512"
# Chunks are at most ~1200 characters (~300 tokens); capping the sequence keeps
# CPU inference fast and matches the length the default model was tuned at.
DEFAULT_MAX_TOKENS = 512


class Embedder(Protocol):
    model_name: str
    dimension: int

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """Local CPU embeddings via sentence-transformers. Loads the model on first use."""

    def __init__(self, model_name: str, max_tokens: int = DEFAULT_MAX_TOKENS) -> None:
        self.model_name = model_name
        self._max_tokens = max_tokens
        self._model = None

    def _load(self):
        if self._model is None:
            # Imported here so the app (and its tests) never pay for torch
            # unless real embeddings are actually requested.
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s", self.model_name)
            model = SentenceTransformer(self.model_name, device="cpu", trust_remote_code=True)
            model.max_seq_length = min(model.max_seq_length, self._max_tokens)
            self._model = model
        return self._model

    @property
    def dimension(self) -> int:
        return self._load().get_sentence_embedding_dimension()

    def warm_up(self) -> None:
        """Load the weights now rather than inside the first upload request."""
        self._load()

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        return self._encode(texts, "document")

    def embed_query(self, text: str) -> list[float]:
        return self._encode([text], "query")[0]

    def _encode(self, texts: list[str], role: str) -> list[list[float]]:
        model = self._load()
        # Some models (nomic/ModernBERT family) want a role prefix; use it only
        # when the model's own config defines one.
        prompt_name = role if role in (model.prompts or {}) else None
        vectors = model.encode(
            texts,
            prompt_name=prompt_name,
            batch_size=8,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        return vectors.tolist()


@lru_cache(maxsize=1)
def get_embedder() -> SentenceTransformerEmbedder:
    return SentenceTransformerEmbedder(
        model_name=os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL),
        max_tokens=int(os.getenv("EMBEDDING_MAX_TOKENS", DEFAULT_MAX_TOKENS)),
    )
