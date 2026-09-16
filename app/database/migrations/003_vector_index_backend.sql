-- MAS-61: the same model name can be served by two backends (a
-- sentence-transformers checkpoint, or a quantised GGUF behind an
-- OpenAI-compatible server) whose vectors are not comparable, so the backend
-- is part of the fingerprint too. Existing rows were all built locally.

ALTER TABLE vector_index
    ADD COLUMN IF NOT EXISTS backend TEXT NOT NULL DEFAULT 'sentence-transformers';
