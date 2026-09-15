# Architecture Notes

The service is organized around a contract review workflow:

1. `app/ingestion` loads contracts, extracts text, chunks clauses, and prepares metadata.
2. `app/retrieval` embeds chunks and retrieves relevant context for user questions.
3. `app/risk_analysis` evaluates retrieved clauses for legal, operational, and commercial risk.
4. `app/actions` turns analysis outputs into review tasks or downstream workflow actions.
5. `app/database` stores contracts, chunks, analyses, and review state.

## Database

Postgres holds two tables: `contracts` (one row per upload) and `chunks` (one
row per text chunk, FK to its contract with cascade delete; `embedding_id`
links the chunk to its vector in Qdrant). The schema lives in numbered SQL
files under `app/database/migrations/`; `run_migrations()` applies any not
yet recorded in `schema_migrations` and runs on API startup, so
`docker compose up --build` always brings a fresh database to the current
schema. `app/database/repository.py` is the only module that issues SQL.

## Embeddings and vector store

`app/retrieval/embeddings.py` wraps a local sentence-transformers model chosen by
`EMBEDDING_MODEL` (default: Free Law's legal-fine-tuned ModernBERT; see CLAUDE.md
for the benchmark behind that choice). `app/retrieval/vector_store.py` keeps one
Qdrant collection, `contract_chunks`, where each point's id **is** the chunk's
Postgres UUID and the payload carries `contract_id`, `chunk_index` and `text`.
On upload, `app/retrieval/indexing.py` embeds the stored chunks, upserts them and
writes the point id back to `chunks.embedding_id`; if that fails the contract is
removed again so nothing unsearchable lingers. At startup the API loads the model
and checks the collection's vector size — a different size means the model
changed, so the collection is rebuilt (existing contracts must be re-uploaded).

The current implementation is a scaffold. The module boundaries are intentionally narrow so each stage can be replaced with production infrastructure without reshaping the API surface.
