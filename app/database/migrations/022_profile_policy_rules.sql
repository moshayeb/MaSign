-- MAS-192: qualitative policy content rules on MAS-188's clause catalog.
-- A rule is free text attached to one (standard profile, clause) pair --
-- "liability cap must not exceed 12 months of fees" -- evaluated only when
-- the clause-presence pass (MAS-188) already found that clause present in
-- the same review batch. Unlike disabled_profile_clauses, absence here means
-- "no rule configured", not "enabled by default": a clause with no row has
-- nothing to check, so it reports not_applicable (computed, never stored).
CREATE TABLE profile_policy_rules (
    profile_id UUID        NOT NULL REFERENCES standard_profiles (id) ON DELETE CASCADE,
    clause_id  TEXT        NOT NULL,
    rule_text  TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (profile_id, clause_id)
);

-- One verified policy verdict per (contract, chunk, clause), same uniqueness
-- shape as clause_findings/key_terms (see 019_profile_clauses.sql) for the
-- same bundle-vs-solo-review reason. `rule_text_checked` snapshots the rule
-- text this verdict was actually judged against: if the profile's rule text
-- for this clause later changes, a stored verdict no longer matches the
-- current rule and must read cannot_tell at read time, not a stale verdict
-- under new wording (the same staleness discipline MAS-193 built for
-- clauses_complete/checked_clause_ids, applied here before it could recur).
CREATE TABLE policy_findings (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id       UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_id          UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    clause_id         TEXT        NOT NULL,
    verdict           TEXT        NOT NULL CHECK (verdict IN ('compliant', 'violated', 'cannot_tell')),
    quote             TEXT        NOT NULL,
    rule_text_checked TEXT        NOT NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (contract_id, chunk_id, clause_id)
);

CREATE INDEX idx_policy_findings_contract_id ON policy_findings (contract_id);

-- The policy pass runs inside the whole-contract review as a fourth,
-- independent call per batch (MAS-129/MAS-188 pattern) -- but only for
-- clauses this batch found present AND that have a configured rule, so it is
-- not a call on every batch regardless. Its own completeness is tracked
-- here, next to the risk, key-terms and clause passes'.
ALTER TABLE risk_reviews ADD COLUMN policy_complete BOOLEAN NOT NULL DEFAULT FALSE;

-- Exactly which clause ids had an active rule the policy pass actually
-- checked during this run (MAS-193-style discipline, see policy_findings
-- comment above): a clause missing from this list -- because no rule was
-- configured for it yet, or it was never present -- must read cannot_tell
-- (or not_applicable, computed), never a stale or invented verdict.
ALTER TABLE risk_reviews ADD COLUMN checked_policy_clause_ids TEXT[] NOT NULL DEFAULT '{}';
