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
# Cap on the tokens the model sees per text. The chunker is given this budget
# (MAS-49) so nothing is silently truncated; 512 matches the length the
# default model was fine-tuned at and keeps CPU inference fast.
DEFAULT_MAX_TOKENS = 512

# Text prefixes a model family was trained with (MAS-51). The nomic / ModernBERT
# embed models expect every document and query to start with these; the
# Free Law fine-tune ships no prompt config of its own, so they are applied
# here, exactly once, and callers never see them.
PROMPT_FORMATS: dict[str, dict[str, str]] = {
    "nomic": {"document": "search_document: ", "query": "search_query: "},
    "none": {},
}


def prompt_format_for(model_name: str) -> str:
    """Pick the prefix scheme for a model, unless EMBEDDING_PROMPT_FORMAT overrides it."""
    configured = os.getenv("EMBEDDING_PROMPT_FORMAT")
    if configured:
        if configured not in PROMPT_FORMATS:
            raise ValueError(
                f"EMBEDDING_PROMPT_FORMAT={configured!r} is not one of {sorted(PROMPT_FORMATS)}."
            )
        return configured
    name = model_name.lower()
    if "modernbert-embed" in name or "nomic-embed" in name:
        return "nomic"
    return "none"


class EmbeddingInputTooLong(ValueError):
    """A text handed to the embedder exceeds its token limit.

    The chunker is responsible for never producing such a text, so this is a
    bug guard rather than an expected condition: better a loud failure than a
    vector that silently ignores the end of a clause.
    """


class Embedder(Protocol):
    model_name: str
    dimension: int
    max_tokens: int
    prompt_format: str

    def count_tokens(self, text: str) -> int:
        """Tokens the model will see for `text` embedded as a document (prefix included)."""
        ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


class SentenceTransformerEmbedder:
    """Local CPU embeddings via sentence-transformers. Loads the model on first use."""

    def __init__(self, model_name: str, max_tokens: int = DEFAULT_MAX_TOKENS) -> None:
        self.model_name = model_name
        self.prompt_format = prompt_format_for(model_name)
        self._prefixes = PROMPT_FORMATS[self.prompt_format]
        self._requested_max_tokens = max_tokens
        self._model = None

    def _load(self):
        if self._model is None:
            # Imported here so the app (and its tests) never pay for torch
            # unless real embeddings are actually requested.
            from sentence_transformers import SentenceTransformer

            logger.info("Loading embedding model %s (prompt format: %s)", self.model_name, self.prompt_format)
            model = SentenceTransformer(self.model_name, device="cpu", trust_remote_code=True)
            model.max_seq_length = min(model.max_seq_length, self._requested_max_tokens)
            self._model = model
        return self._model

    @property
    def dimension(self) -> int:
        return self._load().get_sentence_embedding_dimension()

    @property
    def max_tokens(self) -> int:
        return self._load().max_seq_length

    def warm_up(self) -> None:
        """Load the weights now rather than inside the first upload request."""
        self._load()

    def count_tokens(self, text: str) -> int:
        # Special tokens ([CLS]/[SEP]) count against max_seq_length too.
        tokenizer = self._load().tokenizer
        return len(tokenizer(self._prefixes.get("document", "") + text, add_special_tokens=True)["input_ids"])

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        for text in texts:
            tokens = self.count_tokens(text)
            if tokens > self.max_tokens:
                raise EmbeddingInputTooLong(
                    f"Chunk of {tokens} tokens exceeds the {self.max_tokens}-token limit "
                    f"of {self.model_name}; the chunker should have split it."
                )
        return self._encode(texts, "document")

    def embed_query(self, text: str) -> list[float]:
        return self._encode([text], "query")[0]

    def _encode(self, texts: list[str], role: str) -> list[list[float]]:
        model = self._load()
        prefix = self._prefixes.get(role)
        if prefix is not None:
            texts = [prefix + text for text in texts]
            prompt_name = None
        else:
            # No scheme of our own: use the model's own prompt for the role if
            # it defines one (Qwen3-style instruction prompts, for example).
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
