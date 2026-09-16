"""Turn contract text into vectors.

Two backends share the `Embedder` protocol (MAS-61): sentence-transformers
running the model in-process (the `portable` profile, ModernBERT by default),
and an OpenAI-compatible HTTP service such as llama-server hosting a GGUF
(the `quality` profile, Qwen3-Embedding-4B on a GPU). EMBEDDING_BACKEND picks
one; see CLAUDE.md for the benchmark behind the defaults. Everything else in
the app talks to the protocol, so tests substitute a fake and a model swap is
config.
"""

import logging
import math
import os
from functools import lru_cache
from typing import Protocol

import httpx

logger = logging.getLogger(__name__)

DEFAULT_EMBEDDING_MODEL = "freelawproject/modernbert-embed-base_finetune_512"
# Cap on the tokens the model sees per text. The chunker is given this budget
# (MAS-49) so nothing is silently truncated; 512 matches the length the
# default model was fine-tuned at and keeps CPU inference fast.
DEFAULT_MAX_TOKENS = 512

BACKENDS = ("sentence-transformers", "openai-compatible")
DEFAULT_BACKEND = "sentence-transformers"
DEVICES = ("auto", "cpu", "cuda")

# Text prefixes a model family was trained with (MAS-51). The nomic / ModernBERT
# embed models expect every document and query to start with these; the
# Free Law fine-tune ships no prompt config of its own, so they are applied
# here, exactly once, and callers never see them. Qwen3-Embedding models take
# an instruction on the query side only (their own sentence-transformers
# config carries the same string; an HTTP server has no such config).
PROMPT_FORMATS: dict[str, dict[str, str]] = {
    "nomic": {"document": "search_document: ", "query": "search_query: "},
    "qwen3": {"query": "Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: "},
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
    if "qwen3-embedding" in name:
        return "qwen3"
    return "none"


class EmbeddingInputTooLong(ValueError):
    """A text handed to the embedder exceeds its token limit.

    The chunker is responsible for never producing such a text, so this is a
    bug guard rather than an expected condition: better a loud failure than a
    vector that silently ignores the end of a clause.
    """


class EmbeddingServiceError(RuntimeError):
    """The embedding service could not be reached or gave an unusable answer.

    Raised by the HTTP backend; the API turns it into a 503, and at startup it
    is fatal, both naming the URL that failed.
    """


class Embedder(Protocol):
    backend: str
    model_name: str
    dimension: int
    max_tokens: int
    prompt_format: str

    def warm_up(self) -> None:
        """Load the model / contact the service now rather than in the first request."""
        ...

    def count_tokens(self, text: str) -> int:
        """Tokens the model will see for `text` embedded as a document (prefix included)."""
        ...

    def embed_documents(self, texts: list[str]) -> list[list[float]]: ...

    def embed_query(self, text: str) -> list[float]: ...


def _check_lengths(embedder: Embedder, texts: list[str]) -> None:
    for text in texts:
        tokens = embedder.count_tokens(text)
        if tokens > embedder.max_tokens:
            raise EmbeddingInputTooLong(
                f"Chunk of {tokens} tokens exceeds the {embedder.max_tokens}-token limit "
                f"of {embedder.model_name}; the chunker should have split it."
            )


def resolve_device(requested: str, cuda_available: bool) -> str:
    """Turn EMBEDDING_DEVICE into a torch device name.

    `auto` uses the GPU when torch can see one and falls back to the CPU
    silently; asking for `cuda` outright fails loudly when there is none, so a
    deployment that expects the GPU does not quietly run 6× slower.
    """
    if requested not in DEVICES:
        raise ValueError(f"EMBEDDING_DEVICE={requested!r} is not one of {DEVICES}.")
    if requested == "auto":
        return "cuda" if cuda_available else "cpu"
    if requested == "cuda" and not cuda_available:
        raise ValueError(
            "EMBEDDING_DEVICE=cuda but torch cannot see a GPU (CPU-only torch build, no NVIDIA "
            "driver, or a container started without GPU access). Use EMBEDDING_DEVICE=auto to fall back."
        )
    return requested


class SentenceTransformerEmbedder:
    """Local embeddings via sentence-transformers. Loads the model on first use."""

    backend = "sentence-transformers"

    def __init__(self, model_name: str, max_tokens: int = DEFAULT_MAX_TOKENS, device: str = "auto") -> None:
        self.model_name = model_name
        self.prompt_format = prompt_format_for(model_name)
        self._prefixes = PROMPT_FORMATS[self.prompt_format]
        self._requested_max_tokens = max_tokens
        self._requested_device = device
        self._model = None

    def _load(self):
        if self._model is None:
            # Imported here so the app (and its tests) never pay for torch
            # unless real embeddings are actually requested.
            import torch
            from sentence_transformers import SentenceTransformer

            device = resolve_device(self._requested_device, torch.cuda.is_available())
            logger.info(
                "Loading embedding model %s on %s (prompt format: %s)", self.model_name, device, self.prompt_format
            )
            model = SentenceTransformer(self.model_name, device=device, trust_remote_code=True)
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
        _check_lengths(self, texts)
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
            # it defines one.
            prompt_name = role if role in (model.prompts or {}) else None
        vectors = model.encode(
            texts,
            prompt_name=prompt_name,
            batch_size=8,
            normalize_embeddings=True,
            convert_to_numpy=True,
        )
        return vectors.tolist()


class OpenAICompatibleEmbedder:
    """Embeddings from an OpenAI-style `/v1/embeddings` endpoint (MAS-61).

    Built for llama-server hosting a GGUF on a GPU, but any server speaking
    the OpenAI embeddings API works. Token counts come from llama-server's
    `/tokenize`; a server without it gets a conservative estimate
    (0.5 tokens per character, above the ~0.45 measured on number-dense
    clauses) so the chunker still never produces an oversized chunk. The
    dimension is learned from the first vector the service returns.
    """

    backend = "openai-compatible"
    _BATCH_SIZE = 8
    _ESTIMATED_TOKENS_PER_CHAR = 0.5

    def __init__(
        self,
        model_name: str,
        base_url: str,
        *,
        api_key: str | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        timeout: float = 600.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.model_name = model_name
        self.base_url = base_url.rstrip("/")
        self.max_tokens = max_tokens
        self.prompt_format = prompt_format_for(model_name)
        self._prefixes = PROMPT_FORMATS[self.prompt_format]
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout, transport=transport)
        self._dimension: int | None = None
        self._tokenize_available: bool | None = None

    @property
    def dimension(self) -> int:
        if self._dimension is None:
            self.warm_up()
        assert self._dimension is not None
        return self._dimension

    def warm_up(self) -> None:
        """Contact the service once: proves it is up and learns the vector size."""
        if self._dimension is None:
            self._dimension = len(self._request_vectors(["MaSign embedding probe"])[0])
            logger.info(
                "Embedding service %s ready: %s, %d dims, %d-token limit (prompt format: %s)",
                self.base_url, self.model_name, self._dimension, self.max_tokens, self.prompt_format,
            )

    def count_tokens(self, text: str) -> int:
        text = self._prefixes.get("document", "") + text
        if self._tokenize_available is not False:
            try:
                response = self._client.post("/tokenize", json={"content": text, "add_special": True})
            except httpx.HTTPError as error:
                raise EmbeddingServiceError(f"Embedding service at {self.base_url} is unreachable: {error}") from error
            if response.status_code == 200:
                self._tokenize_available = True
                return len(response.json()["tokens"])
            if self._tokenize_available is None:
                logger.warning(
                    "Embedding service %s has no /tokenize endpoint (HTTP %d); estimating %.1f tokens per character",
                    self.base_url, response.status_code, self._ESTIMATED_TOKENS_PER_CHAR,
                )
            self._tokenize_available = False
        return math.ceil(len(text) * self._ESTIMATED_TOKENS_PER_CHAR)

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        _check_lengths(self, texts)
        prefix = self._prefixes.get("document", "")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), self._BATCH_SIZE):
            batch = [prefix + text for text in texts[start : start + self._BATCH_SIZE]]
            vectors.extend(self._request_vectors(batch))
        return vectors

    def embed_query(self, text: str) -> list[float]:
        return self._request_vectors([self._prefixes.get("query", "") + text])[0]

    def _request_vectors(self, inputs: list[str]) -> list[list[float]]:
        try:
            response = self._client.post("/v1/embeddings", json={"model": self.model_name, "input": inputs})
            response.raise_for_status()
            data = response.json()["data"]
        except httpx.HTTPStatusError as error:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} answered HTTP {error.response.status_code}: "
                f"{error.response.text[:200]}"
            ) from error
        except (httpx.HTTPError, KeyError, ValueError) as error:
            raise EmbeddingServiceError(f"Embedding service at {self.base_url} is unreachable: {error}") from error
        if len(data) != len(inputs):
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned {len(data)} vectors for {len(inputs)} inputs."
            )
        # Unit-length, like the sentence-transformers backend, so scores mean the same.
        return [_normalised(item["embedding"]) for item in sorted(data, key=lambda item: item["index"])]


def _normalised(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [value / norm for value in vector]


@lru_cache(maxsize=1)
def get_embedder() -> Embedder:
    backend = os.getenv("EMBEDDING_BACKEND", DEFAULT_BACKEND)
    model_name = os.getenv("EMBEDDING_MODEL", DEFAULT_EMBEDDING_MODEL)
    max_tokens = int(os.getenv("EMBEDDING_MAX_TOKENS", DEFAULT_MAX_TOKENS))
    if backend == "sentence-transformers":
        return SentenceTransformerEmbedder(
            model_name=model_name,
            max_tokens=max_tokens,
            device=os.getenv("EMBEDDING_DEVICE", "auto"),
        )
    if backend == "openai-compatible":
        base_url = os.getenv("EMBEDDING_API_URL")
        if not base_url:
            raise ValueError("EMBEDDING_BACKEND=openai-compatible needs EMBEDDING_API_URL (e.g. http://llama-server:8081).")
        return OpenAICompatibleEmbedder(
            model_name=model_name,
            base_url=base_url,
            api_key=os.getenv("EMBEDDING_API_KEY") or None,
            max_tokens=max_tokens,
        )
    raise ValueError(f"EMBEDDING_BACKEND={backend!r} is not one of {BACKENDS}.")
