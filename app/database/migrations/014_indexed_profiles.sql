-- MAS-62 (compare mode): which embedding profiles this contract has actually
-- been indexed into. Read from Postgres, not Qdrant, so the contract list
-- and the compare toggle never pay for a per-contract vector-store round
-- trip -- Qdrant stays the source of truth for search itself, this column
-- is just a durable record of what indexing already did. "portable" is
-- always present (required at upload); "quality" is added only once its
-- best-effort indexing actually succeeds for that contract.
ALTER TABLE contracts
    ADD COLUMN IF NOT EXISTS indexed_profiles TEXT[] NOT NULL DEFAULT ARRAY['portable'];
