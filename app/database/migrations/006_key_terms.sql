-- MAS-82: financial key terms per contract, one row per verified (term,
-- passage) pair. Several rows for one term mean it is stated in several
-- passages; the API reports the first and lists the others (or "conflicting"
-- when their values differ). `typed` holds the machine-readable value when
-- every number in it was found in the quote, else NULL (text only).
CREATE TABLE IF NOT EXISTS key_terms (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_id    UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    term        TEXT        NOT NULL,
    value       TEXT        NOT NULL,
    quote       TEXT        NOT NULL,
    typed       JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, term)
);

CREATE INDEX IF NOT EXISTS idx_key_terms_contract_id ON key_terms (contract_id);

-- The key-terms pass runs inside the whole-contract review; its own
-- completeness is tracked here, next to the risk pass's.
ALTER TABLE risk_reviews ADD COLUMN IF NOT EXISTS key_terms_complete BOOLEAN NOT NULL DEFAULT FALSE;
