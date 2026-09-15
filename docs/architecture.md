# Architecture Notes

The service is organized around a contract review workflow:

1. `app/ingestion` loads contracts, extracts text, chunks clauses, and prepares metadata.
2. `app/retrieval` embeds chunks and retrieves relevant context for user questions.
3. `app/risk_analysis` evaluates retrieved clauses for legal, operational, and commercial risk.
4. `app/actions` turns analysis outputs into review tasks or downstream workflow actions.
5. `app/database` stores contracts, chunks, analyses, and review state.

## Database

Postgres holds three tables: `contracts` (one row per upload), `chunks` (one
row per text chunk, FK to its contract with cascade delete; `embedding_id`
links the chunk to its vector in Qdrant) and `vector_index` (one row per Qdrant
collection recording the embedder it was built with). The schema lives in numbered SQL
files under `app/database/migrations/`; `run_migrations()` applies any not
yet recorded in `schema_migrations` and runs on API startup, so
`docker compose up --build` always brings a fresh database to the current
schema. `app/database/repository.py` is the only module that issues SQL.

## Embeddings and vector store

`app/retrieval/embeddings.py` wraps a local sentence-transformers model chosen by
`EMBEDDING_MODEL` (default: Free Law's legal-fine-tuned ModernBERT; see CLAUDE.md
for the benchmark behind that choice). The embedder owns the model's input
format: the ModernBERT/nomic family expects `search_document: ` / `search_query: `
prefixes, which it adds itself so no caller has to know. It also exposes
`count_tokens`/`max_tokens`, and the upload route hands those to the chunker as a
`TokenBudget` so every chunk fits the model's sequence limit — characters alone
are not a safe proxy (number-dense clauses reach ~0.45 tokens/char). An oversized
text reaching `embed_documents` is a bug and raises rather than being truncated.

`app/retrieval/vector_store.py` keeps one Qdrant collection, `contract_chunks`,
where each point's id **is** the chunk's Postgres UUID and the payload carries
`contract_id`, `chunk_index` and `text`. On upload, `app/retrieval/indexing.py`
embeds the stored chunks, upserts them and writes the point id back to
`chunks.embedding_id`; if that fails the contract is removed from both stores
again so nothing unsearchable lingers.

At startup the API loads the model and compares the collection's recorded
fingerprint (`vector_index`: model, dimension, token limit, prompt format) with
the configured embedder. Any difference — or a missing collection — rebuilds the
collection and re-embeds every chunk from Postgres, so switching models is a
config change with no re-upload.

The current implementation is a scaffold. The module boundaries are intentionally narrow so each stage can be replaced with production infrastructure without reshaping the API surface.
