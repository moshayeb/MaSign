-- Initial schema: one row per uploaded contract, one row per text chunk.
-- embedding_id links a chunk to its vector in Qdrant (filled in by MAS-11).

CREATE TABLE IF NOT EXISTS contracts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        TEXT        NOT NULL,
    file_type       TEXT        NOT NULL,
    size_bytes      INTEGER     NOT NULL,
    character_count INTEGER     NOT NULL,
    chunk_count     INTEGER     NOT NULL DEFAULT 0,
    status          TEXT        NOT NULL DEFAULT 'processed',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chunks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id  UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_index  INTEGER     NOT NULL,
    chunk_text   TEXT        NOT NULL,
    embedding_id TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_chunks_contract_id ON chunks (contract_id);
