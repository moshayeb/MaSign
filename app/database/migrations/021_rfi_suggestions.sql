-- MAS-189: a drafted clarifying question (RFI) for a flagged risk finding --
-- the first MaSign feature where the model generates new text instead of
-- extracting it. `category`/`reason`/`quote` are a SNAPSHOT of the finding
-- at generation time, not a live pointer: `risk_findings` rows are deleted
-- and re-inserted (fresh ids) on every re-review, so a FK there would
-- silently wipe every stored suggestion the moment a contract is
-- re-reviewed. Same precedent `questions.response` already sets -- store
-- the full content, not a pointer back to state that can churn. `chunk_id`
-- itself is kept (chunks do not churn on re-review) so a stored suggestion
-- can still open its source passage.
CREATE TABLE rfi_suggestions (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    contract_id  UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    chunk_id     UUID        NOT NULL REFERENCES chunks (id) ON DELETE CASCADE,
    category     TEXT        NOT NULL,
    reason       TEXT        NOT NULL,
    quote        TEXT        NOT NULL,
    question     TEXT        NOT NULL,
    model        TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_rfi_suggestions_contract ON rfi_suggestions (contract_id);
CREATE INDEX idx_rfi_suggestions_workspace ON rfi_suggestions (workspace_id);
