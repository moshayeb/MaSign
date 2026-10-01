-- MAS-92: invoice verification against a contract's verified key terms
-- (fees, due dates, late-payment rates). An invoice is never run through
-- POST /api/contracts/upload -- that endpoint indexes the file for search and
-- automatically starts the commercial-contract risk review (MAS-81), neither
-- of which applies to an invoice (MAS-107's document-kind check already
-- flags one, but only as a hint, never a gate). Invoices get their own
-- minimal, workspace-scoped pipeline instead (MAS-143).
--
-- Unlike contract chunking (app/ingestion/pipeline.py), page boundaries are
-- kept rather than flattened into one text blob: an invoice is usually one or
-- two pages, and the story asks for page-level source citations, so
-- `invoice_chunks.chunk_index` is the real 1-based PDF page number -- one row
-- per readable page, never a sequential position -- rather than an opaque
-- chunk index.

CREATE TABLE IF NOT EXISTS invoices (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id    UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    contract_id     UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    filename        TEXT        NOT NULL,
    size_bytes      INTEGER     NOT NULL,
    character_count INTEGER     NOT NULL,
    page_count      INTEGER     NOT NULL,
    ingestion_notes JSONB       NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoices_contract ON invoices (contract_id);
CREATE INDEX IF NOT EXISTS idx_invoices_workspace ON invoices (workspace_id);

CREATE TABLE IF NOT EXISTS invoice_chunks (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id  UUID    NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL,
    chunk_text  TEXT    NOT NULL,
    UNIQUE (invoice_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_invoice_chunks_invoice ON invoice_chunks (invoice_id);

-- One row per invoice-vs-contract comparison run. Re-checking the same
-- invoice adds a new row rather than overwriting the old one, so a past
-- outcome stays auditable -- the same spirit as risk reviews never being
-- silently replaced.
CREATE TABLE IF NOT EXISTS invoice_checks (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    invoice_id   UUID        NOT NULL REFERENCES invoices (id) ON DELETE CASCADE,
    contract_id  UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    model        TEXT,
    checked      BOOLEAN     NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_checks_invoice ON invoice_checks (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_checks_contract ON invoice_checks (contract_id);

-- One row per compared item (a fee, a due date, a late-payment rate). Carries
-- both sides' evidence so match/possible_mismatch/cannot_verify is never
-- shown without the citations that justify it (honest-outcomes).
CREATE TABLE IF NOT EXISTS invoice_check_items (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_check_id    UUID        NOT NULL REFERENCES invoice_checks (id) ON DELETE CASCADE,
    label               TEXT        NOT NULL,
    outcome             TEXT        NOT NULL,  -- match | possible_mismatch | cannot_verify
    reason              TEXT        NOT NULL,
    contract_term       TEXT,                  -- app.key_terms.terms id, when a contract term was found
    contract_value      TEXT,
    contract_quote      TEXT,
    contract_chunk_id   UUID        REFERENCES chunks (id) ON DELETE SET NULL,
    source_contract_id  UUID        REFERENCES contracts (id) ON DELETE SET NULL,
    invoice_field       TEXT,                  -- app.invoices.fields id, when an invoice field was found
    invoice_value       TEXT,
    invoice_quote       TEXT,
    invoice_chunk_id    UUID        REFERENCES invoice_chunks (id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_invoice_check_items_check ON invoice_check_items (invoice_check_id);
