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
from collections.abc import Callable
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
    the OpenAI embeddings API works. Token counts must be exact — an estimate
    let 661-token text pass as 495 (MAS-63) — so they come from llama-server's
    `/tokenize`, or from the matching Hugging Face tokenizer named by
    EMBEDDING_TOKENIZER for a server without that endpoint; with neither, the
    embedder refuses to start. The dimension is learned from the first vector
    the service returns.
    """

    backend = "openai-compatible"
    _BATCH_SIZE = 8

    def __init__(
        self,
        model_name: str,
        base_url: str,
        *,
        api_key: str | None = None,
        max_tokens: int = DEFAULT_MAX_TOKENS,
        tokenizer: str | None = None,
        timeout: float = 600.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        self.model_name = model_name
        self.base_url = base_url.rstrip("/")
        self.max_tokens = max_tokens
        self.prompt_format = prompt_format_for(model_name)
        self._prefixes = PROMPT_FORMATS[self.prompt_format]
        self._tokenizer_name = tokenizer
        headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
        self._client = httpx.Client(base_url=self.base_url, headers=headers, timeout=timeout, transport=transport)
        self._dimension: int | None = None
        # Set by warm_up(): counts a text exactly, via the server or locally.
        self._count: Callable[[str], int] | None = None

    @property
    def dimension(self) -> int:
        if self._dimension is None:
            self.warm_up()
        assert self._dimension is not None
        return self._dimension

    def warm_up(self) -> None:
        """Contact the service once: proves it is up, learns the vector size, picks the token counter."""
        if self._dimension is None:
            self._dimension = len(self._request_vectors(["MaSign embedding probe"])[0])
        if self._count is None:
            self._count = self._choose_token_counter()
            logger.info(
                "Embedding service %s ready: %s, %d dims, %d-token limit (prompt format: %s)",
                self.base_url, self.model_name, self._dimension, self.max_tokens, self.prompt_format,
            )

    def _choose_token_counter(self) -> Callable[[str], int]:
        # Decided once, here: whether /tokenize exists is a property of the
        # server, while a failure during a request is a passing outage and
        # must never flip the counting mode (MAS-64).
        response = self._post_tokenize("probe")
        if response.status_code == 200:
            # Count the probe for real, so a server whose /tokenize answers
            # 200 with an unusable body is refused here, not trusted later (MAS-67).
            self._tokens_in(response)
            return self._count_via_server
        if response.status_code not in (404, 405):
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} answered HTTP {response.status_code} to /tokenize."
            )
        if not self._tokenizer_name:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} has no /tokenize endpoint, so token counts cannot "
                f"be exact; set EMBEDDING_TOKENIZER to the model's Hugging Face tokenizer "
                f"(e.g. Qwen/Qwen3-Embedding-4B)."
            )
        from transformers import AutoTokenizer

        logger.info("Embedding service %s has no /tokenize; counting with tokenizer %s", self.base_url, self._tokenizer_name)
        tokenizer = AutoTokenizer.from_pretrained(self._tokenizer_name)
        return lambda text: len(tokenizer(text, add_special_tokens=True)["input_ids"])

    def _post_tokenize(self, text: str) -> httpx.Response:
        try:
            return self._client.post("/tokenize", json={"content": text, "add_special": True})
        except httpx.HTTPError as error:
            raise EmbeddingServiceError(f"Embedding service at {self.base_url} is unreachable: {error}") from error

    def _count_via_server(self, text: str) -> int:
        response = self._post_tokenize(text)
        if response.status_code != 200:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} answered HTTP {response.status_code} to /tokenize."
            )
        return self._tokens_in(response)

    def _tokens_in(self, response: httpx.Response) -> int:
        # llama-server answers {"tokens": [int, ...]}; anything else (a string,
        # which len() would happily count, a missing key, non-JSON) is unusable
        # rather than a number to trust with the size limit (MAS-67).
        try:
            tokens = response.json()["tokens"]
        except (KeyError, TypeError, ValueError) as error:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned an unusable /tokenize response: {error!r}"
            ) from error
        if not isinstance(tokens, list) or not all(isinstance(token, int) for token in tokens):
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned an unusable /tokenize response: "
                f"'tokens' is not a list of integers ({str(tokens)[:60]!r})."
            )
        return len(tokens)

    def count_tokens(self, text: str) -> int:
        if self._count is None:
            self.warm_up()
        assert self._count is not None
        return self._count(self._prefixes.get("document", "") + text)

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
        except httpx.HTTPError as error:
            raise EmbeddingServiceError(f"Embedding service at {self.base_url} is unreachable: {error}") from error
        except (KeyError, TypeError, ValueError) as error:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned an unusable response: {error!r}"
            ) from error
        try:
            vectors = _vectors_in_order(data, len(inputs))
        except ValueError as error:
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned an unusable response: {error}"
            ) from error
        if self._dimension is not None and any(len(vector) != self._dimension for vector in vectors):
            raise EmbeddingServiceError(
                f"Embedding service at {self.base_url} returned vectors of a different size than the "
                f"{self._dimension} dims the index was built with."
            )
        # Unit-length, like the sentence-transformers backend, so scores mean the same.
        return [_normalised(vector) for vector in vectors]


def _vectors_in_order(data: object, expected: int) -> list[list[float]]:
    """The vectors of an OpenAI-style `data` list, by `index` — or ValueError on any malformed item (MAS-65)."""
    if not isinstance(data, list) or len(data) != expected:
        raise ValueError(f"expected {expected} vectors, got {len(data) if isinstance(data, list) else data!r}")
    by_index: dict[int, list[float]] = {}
    for item in data:
        if not isinstance(item, dict) or not isinstance(item.get("index"), int):
            raise ValueError(f"item without an integer index: {str(item)[:80]}")
        vector = item.get("embedding")
        if not isinstance(vector, list) or not vector or not all(isinstance(v, (int, float)) for v in vector):
            raise ValueError(f"item {item['index']} has no numeric embedding list")
        by_index[item["index"]] = [float(v) for v in vector]
    if sorted(by_index) != list(range(expected)):
        raise ValueError(f"indices {sorted(by_index)} do not cover 0..{expected - 1}")
    vectors = [by_index[i] for i in range(expected)]
    if len({len(v) for v in vectors}) != 1:
        raise ValueError("vectors of differing lengths")
    return vectors


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
            tokenizer=os.getenv("EMBEDDING_TOKENIZER") or None,
        )
    raise ValueError(f"EMBEDDING_BACKEND={backend!r} is not one of {BACKENDS}.")
