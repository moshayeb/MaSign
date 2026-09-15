-- MAS-52: what the Qdrant collection was built with. One row per collection.
-- On startup the app compares this fingerprint with the configured embedder;
-- any difference (model, token limit, prefix scheme, dimension) means the
-- stored vectors are incompatible and the collection is rebuilt from the
-- chunk text in Postgres.

CREATE TABLE IF NOT EXISTS vector_index (
    collection    TEXT        PRIMARY KEY,
    model_name    TEXT        NOT NULL,
    dimension     INTEGER     NOT NULL,
    max_tokens    INTEGER     NOT NULL,
    prompt_format TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
