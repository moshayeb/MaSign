-- MAS-81: every contract gets a whole-contract risk review (the MAS-15 rubric
-- over all of its chunks). One status row per contract, one row per verified
-- finding; both go with the contract.

CREATE TABLE IF NOT EXISTS risk_reviews (
    contract_id    UUID        PRIMARY KEY REFERENCES contracts (id) ON DELETE CASCADE,
    status         TEXT        NOT NULL DEFAULT 'pending',  -- pending | running | done | failed
    model          TEXT,
    chunks_total   INTEGER     NOT NULL DEFAULT 0,
    chunks_checked INTEGER     NOT NULL DEFAULT 0,
    complete       BOOLEAN     NOT NULL DEFAULT FALSE,
    error          TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS risk_findings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_id    UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    category    TEXT        NOT NULL,
    severity    TEXT        NOT NULL,
    reason      TEXT        NOT NULL,
    quote       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (chunk_id, category)
);

CREATE INDEX IF NOT EXISTS idx_risk_findings_contract_id ON risk_findings (contract_id);
