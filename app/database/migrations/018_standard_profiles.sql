-- MAS-185: named standard profiles (teacher question, 2026-10-01) -- a
-- workspace can define more than one named set of the 4 MAS-120 numeric
-- standards and assign one per contract. A contract with none assigned
-- uses the workspace's single `is_default` profile -- today's MAS-120/181
-- behaviour, preserved: existing `standards` rows are filed under each
-- workspace's new "Default" profile rather than the workspace directly, so
-- current users see no change.

CREATE TABLE standard_profiles (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         TEXT        NOT NULL,
    is_default   BOOLEAN     NOT NULL DEFAULT false,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, name)
);

CREATE INDEX idx_standard_profiles_workspace ON standard_profiles (workspace_id);

-- One "Default" profile per workspace that already has overrides, carrying
-- today's standards rows forward unchanged. A workspace with no overrides
-- at all gets its default profile lazily (repository.get_or_create_default_profile)
-- rather than an empty row inserted here for every workspace that will ever exist.
INSERT INTO standard_profiles (workspace_id, name, is_default)
SELECT DISTINCT workspace_id, 'Default', true FROM standards;

ALTER TABLE standards ADD COLUMN profile_id UUID REFERENCES standard_profiles (id) ON DELETE CASCADE;
UPDATE standards s SET profile_id = sp.id
    FROM standard_profiles sp
    WHERE sp.workspace_id = s.workspace_id AND sp.name = 'Default';
ALTER TABLE standards ALTER COLUMN profile_id SET NOT NULL;
ALTER TABLE standards DROP CONSTRAINT standards_pkey;
ALTER TABLE standards DROP COLUMN workspace_id;
ALTER TABLE standards ADD PRIMARY KEY (profile_id, term_id);

-- NULL = use the workspace's default profile. ON DELETE SET NULL means
-- deleting a profile a contract is using falls the contract back to the
-- workspace default automatically -- never a dangling reference, never an
-- app-level reassignment step that could be skipped (honest-outcomes).
ALTER TABLE contracts ADD COLUMN standard_profile_id UUID REFERENCES standard_profiles (id) ON DELETE SET NULL;
CREATE INDEX idx_contracts_standard_profile ON contracts (standard_profile_id);
