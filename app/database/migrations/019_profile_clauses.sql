-- MAS-188: the expected-clause checklist. Which clauses apply is a property
-- of a standard profile (MAS-185), the same way the 4 numeric standards are.
-- The clause catalog itself is fixed in code (app/key_terms/clauses.py), not
-- free text; a profile's row here only ever records a *disabled* clause --
-- absence means enabled, same "missing row = default" discipline as
-- `standards` (014_standards.sql), so every existing and future profile
-- starts with the full starter catalog enabled with no backfill needed.
CREATE TABLE disabled_profile_clauses (
    profile_id UUID NOT NULL REFERENCES standard_profiles (id) ON DELETE CASCADE,
    clause_id  TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, clause_id)
);

-- One verified clause-presence row per (contract, chunk, clause), same shape
-- as key_terms minus value/typed (a clause has no extracted value, only a
-- quote proving it is there). `(contract_id, chunk_id, clause_id)` is the
-- uniqueness, not chunk_id alone, for the same bundle-vs-solo-review reason
-- key_terms and risk_findings already need it (MAS-138/MAS-139, see
-- 011_scope_uniqueness_to_reviewing_contract.sql).
CREATE TABLE clause_findings (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_id    UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    clause_id   TEXT        NOT NULL,
    quote       TEXT        NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, chunk_id, clause_id)
);

CREATE INDEX idx_clause_findings_contract_id ON clause_findings (contract_id);

-- The clause-check pass runs inside the whole-contract review as a third,
-- independent call per batch (MAS-129 pattern); its own completeness is
-- tracked here, next to the risk and key-terms passes'.
ALTER TABLE risk_reviews ADD COLUMN clauses_complete BOOLEAN NOT NULL DEFAULT FALSE;
