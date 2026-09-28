"""MAS-62: compare mode -- every upload indexes into the required `portable`
profile and, best-effort, into the optional `quality` profile; /api/query can
be pointed at either. Unit coverage for the profile-aware config plumbing
(embeddings.py, vector_store.py) plus the upload/query behaviour end to end,
all with fakes -- no GPU, no live llama-server, matching the MAS-62 spec
comment's decision not to attempt that from this session.
"""

from uuid import uuid4

import pytest
from qdrant_client import QdrantClient

from app.api import dependencies
from app.database import repository
from app.main import app
from app.retrieval import embeddings, vector_store as vector_store_module
from app.retrieval.embeddings import ProfileNotConfigured
from app.retrieval.vector_store import VectorStore
from tests.conftest import FakeEmbedder

from fastapi.testclient import TestClient

client = TestClient(app)

pytestmark = pytest.mark.usefixtures("db")


class FakeQualityEmbedder(FakeEmbedder):
    """A second, distinct fake profile -- different dimension and model name
    so a test that mixes the two up fails loudly (a Qdrant dimension error),
    the same way a real ModernBERT/Qwen3 mismatch would."""

    backend = "fake"
    model_name = "fake-quality-embedder"
    dimension = 32


@pytest.fixture
def quality_store() -> VectorStore:
    store = VectorStore(QdrantClient(":memory:"), collection="test_chunks_quality")
    store.ensure_collection(FakeQualityEmbedder.dimension)
    return store


def _enable_quality(monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore, *, embed_error: Exception | None = None):
    """Make the quality profile "configured" and route embeddings.py /
    vector_store.py's profile-keyed functions to fakes, bypassing FastAPI's
    Depends (which only ever wires the portable profile, MAS-61) since
    upload/query resolve a non-default profile by calling these directly."""
    quality_embedder = FakeQualityEmbedder()
    if embed_error is not None:
        def _raise(texts: list[str]) -> list[list[float]]:
            raise embed_error

        quality_embedder.embed_documents = _raise  # type: ignore[method-assign]

    monkeypatch.setattr(embeddings, "is_profile_configured", lambda profile: profile in ("portable", "quality"))

    # Routes only ever call these two directly for "quality" -- "portable"
    # always goes through FastAPI's Depends, which conftest's autouse
    # _fake_retrieval_stack fixture already overrides to the shared
    # fake_embedder/vector_store fixtures. A "portable" call landing here
    # would mean that assumption broke, so it fails loudly rather than
    # silently trying to load a real model.
    def fake_get_embedder(profile: str = "portable"):
        if profile == "quality":
            return quality_embedder
        raise AssertionError(f"unexpected get_embedder({profile!r}) call: portable should go through Depends")

    def fake_get_vector_store(profile: str = "portable"):
        if profile == "quality":
            return quality_store
        raise AssertionError(f"unexpected get_vector_store({profile!r}) call: portable should go through Depends")

    monkeypatch.setattr(embeddings, "get_embedder", fake_get_embedder)
    monkeypatch.setattr(vector_store_module, "get_vector_store", fake_get_vector_store)
    return quality_embedder


CONTRACT_TEXT = "2. Fees. Customer shall pay EUR 18,500 per month. Payment is due thirty (30) days after the invoice date."


def _upload(filename: str = "c.txt") -> dict:
    response = client.post("/api/contracts/upload", files={"file": (filename, CONTRACT_TEXT.encode(), "text/plain")})
    assert response.status_code == 200, response.text
    return response.json()


# --- embeddings.py: profile-keyed configuration -------------------------------------------------


def test_portable_is_always_configured_quality_is_not_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QUALITY_EMBEDDING_API_URL", raising=False)
    assert embeddings.is_profile_configured("portable") is True
    assert embeddings.is_profile_configured("quality") is False


def test_quality_env_vars_are_independent_of_portables(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EMBEDDING_MODEL", "freelawproject/modernbert-embed-base_finetune_512")
    monkeypatch.setenv("QUALITY_EMBEDDING_API_URL", "http://llama-server:8081")
    monkeypatch.setenv("QUALITY_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B-GGUF:Q4_K_M")
    monkeypatch.setenv("QUALITY_EMBEDDING_MAX_TOKENS", "4096")
    embeddings.get_embedder.cache_clear()

    portable = embeddings.get_embedder("portable")
    quality = embeddings.get_embedder("quality")

    assert portable.model_name == "freelawproject/modernbert-embed-base_finetune_512"
    assert quality.model_name == "Qwen/Qwen3-Embedding-4B-GGUF:Q4_K_M"
    assert quality.max_tokens == 4096
    assert quality.backend == "openai-compatible"
    embeddings.get_embedder.cache_clear()


def test_quality_defaults_match_the_documented_quality_profile_when_only_the_url_is_set(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("QUALITY_EMBEDDING_API_URL", "http://llama-server:8081")
    embeddings.get_embedder.cache_clear()

    quality = embeddings.get_embedder("quality")

    assert quality.model_name == embeddings.QUALITY_DEFAULT_MODEL
    assert quality.backend == "openai-compatible"
    embeddings.get_embedder.cache_clear()


def test_requesting_quality_with_no_url_raises_profile_not_configured(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QUALITY_EMBEDDING_API_URL", raising=False)
    embeddings.get_embedder.cache_clear()

    with pytest.raises(ProfileNotConfigured, match="quality.*QUALITY_EMBEDDING_API_URL"):
        embeddings.get_embedder("quality")
    embeddings.get_embedder.cache_clear()


def test_unknown_profile_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    with pytest.raises(ValueError, match="profile"):
        embeddings.get_embedder("premium")
    with pytest.raises(ValueError, match="profile"):
        embeddings.is_profile_configured("premium")


def test_quality_prompt_format_override_never_reads_portables_variable(monkeypatch: pytest.MonkeyPatch) -> None:
    # A portable-only override must not leak into quality's model-name sniffing.
    monkeypatch.setenv("EMBEDDING_PROMPT_FORMAT", "none")
    monkeypatch.setenv("QUALITY_EMBEDDING_API_URL", "http://llama-server:8081")
    monkeypatch.setenv("QUALITY_EMBEDDING_MODEL", "Qwen/Qwen3-Embedding-4B-GGUF:Q4_K_M")
    monkeypatch.delenv("QUALITY_EMBEDDING_PROMPT_FORMAT", raising=False)
    embeddings.get_embedder.cache_clear()

    quality = embeddings.get_embedder("quality")

    assert quality.prompt_format == "qwen3"  # sniffed from the model name, not forced to "none"
    embeddings.get_embedder.cache_clear()


# --- vector_store.py: one collection per profile -------------------------------------------------


def test_quality_collection_defaults_to_a_suffixed_name_portable_is_unsuffixed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("QDRANT_COLLECTION", raising=False)
    monkeypatch.delenv("QUALITY_QDRANT_COLLECTION", raising=False)
    vector_store_module.get_vector_store.cache_clear()

    portable_store = vector_store_module.get_vector_store("portable")
    quality_store_ = vector_store_module.get_vector_store("quality")

    assert portable_store.collection == "contract_chunks"  # unchanged, no deployment is silently orphaned
    assert quality_store_.collection == "contract_chunks_quality"
    vector_store_module.get_vector_store.cache_clear()


# --- upload: portable required, quality best-effort ----------------------------------------------


def test_upload_indexes_portable_only_when_quality_is_not_configured() -> None:
    contract = _upload()
    assert contract["indexed_profiles"] == ["portable"]


def test_upload_indexes_both_profiles_when_quality_is_configured(monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore) -> None:
    _enable_quality(monkeypatch, quality_store)

    contract = _upload()

    assert contract["indexed_profiles"] == ["portable", "quality"]
    assert quality_store.count(contract_id=uuid_of(contract)) == 1

    # Persisted, not just in the just-uploaded response.
    fetched = client.get(f"/api/contracts/{contract['contract_id']}").json()
    assert fetched["indexed_profiles"] == ["portable", "quality"]


def test_a_failed_quality_indexing_never_fails_the_upload_or_loses_portable(
    monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore
) -> None:
    _enable_quality(monkeypatch, quality_store, embed_error=RuntimeError("simulated GPU server outage"))

    contract = _upload()

    assert contract["indexed_profiles"] == ["portable"]  # quality silently degraded, not fatal
    # Portable itself is fully intact: the contract is there, and a portable question still works.
    answer = client.post("/api/query", json={"question": "When is payment due?", "contract_id": contract["contract_id"]})
    assert answer.status_code == 200
    assert answer.json()["profile"] == "portable"


def uuid_of(contract: dict):
    from uuid import UUID

    return UUID(contract["contract_id"])


# --- query: profile selection -------------------------------------------------------------------


def test_query_defaults_to_the_portable_profile() -> None:
    contract = _upload()
    body = client.post("/api/query", json={"question": "When is payment due?", "contract_id": contract["contract_id"]}).json()
    assert body["profile"] == "portable"


def test_query_with_an_unknown_profile_value_is_a_422() -> None:
    contract = _upload()
    response = client.post(
        "/api/query", json={"question": "x?", "contract_id": contract["contract_id"], "profile": "premium"}
    )
    assert response.status_code == 422


def test_query_quality_profile_is_409_when_not_configured_at_all() -> None:
    contract = _upload()
    response = client.post(
        "/api/query", json={"question": "When is payment due?", "contract_id": contract["contract_id"], "profile": "quality"}
    )
    assert response.status_code == 409
    assert "quality" in response.json()["detail"]


def test_query_quality_profile_is_409_for_a_contract_indexed_before_quality_was_configured(
    monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore
) -> None:
    contract = _upload()  # quality not yet configured at upload time
    _enable_quality(monkeypatch, quality_store)  # now it is, but this contract was never re-indexed

    response = client.post(
        "/api/query", json={"question": "When is payment due?", "contract_id": contract["contract_id"], "profile": "quality"}
    )
    assert response.status_code == 409
    assert "not been indexed" in response.json()["detail"]


def test_query_quality_profile_answers_from_the_quality_collection_and_says_so(
    monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore
) -> None:
    _enable_quality(monkeypatch, quality_store)
    contract = _upload()

    body = client.post(
        "/api/query", json={"question": "When is payment due?", "contract_id": contract["contract_id"], "profile": "quality"}
    ).json()

    assert body["profile"] == "quality"
    assert body["retrieved_context"], "quality's own collection must have been searched, not left empty"


def test_query_quality_profile_with_no_contract_id_searches_whatever_is_indexed_no_error(
    monkeypatch: pytest.MonkeyPatch, quality_store: VectorStore
) -> None:
    # The "all contracts" case never 409s on a per-contract indexing gap --
    # it just searches whatever the quality collection actually has.
    _enable_quality(monkeypatch, quality_store)
    _upload()

    response = client.post("/api/query", json={"question": "When is payment due?", "profile": "quality"})
    assert response.status_code == 200
    assert response.json()["profile"] == "quality"
