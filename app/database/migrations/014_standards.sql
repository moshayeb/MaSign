-- MAS-120: editable company standards. One shared set (no named profiles,
-- no per-workspace scoping -- MAS-143's accounts/workspaces are not merged
-- to main yet; see the MAS-120 Jira comment). A row's absence means "use
-- MaSign's built-in default for this term" -- resetting a standard is a
-- DELETE, never a row holding default values, so the default itself only
-- ever lives in one place (app/key_terms/standards.py).
CREATE TABLE IF NOT EXISTS standards (
    term_id    TEXT        PRIMARY KEY,
    params     JSONB       NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
