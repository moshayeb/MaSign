-- MAS-137: an uploaded contract explicitly linked as the resolution of a
-- named external reference on another contract (e.g. "Statement of Work").
-- Directional -- primary_contract_id is the contract with the gap,
-- linked_contract_id is what closes it -- and one level deep by design: a
-- linked contract's own external references are not auto-included, no
-- chaining. Never created by a heuristic: always an explicit, user-confirmed
-- action (app/api/routes.py) -- the reference detector (MAS-84) proves a
-- reference exists in the text, never that a given uploaded file IS it.
CREATE TABLE IF NOT EXISTS contract_links (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    primary_contract_id UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    linked_contract_id  UUID        NOT NULL REFERENCES contracts (id) ON DELETE CASCADE,
    reference_name      TEXT        NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (primary_contract_id, linked_contract_id, reference_name),
    CHECK (primary_contract_id <> linked_contract_id)
);

CREATE INDEX IF NOT EXISTS idx_contract_links_primary ON contract_links (primary_contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_links_linked ON contract_links (linked_contract_id);
