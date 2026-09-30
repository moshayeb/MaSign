-- MAS-181: standards created before personal workspaces existed belong to the
-- explicit legacy demo workspace used by migration 015, not to every account.
-- Fresh personal workspaces start with MaSign's built-in defaults.
ALTER TABLE standards ADD COLUMN workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE;
UPDATE standards SET workspace_id = '00000000-0000-0000-0000-000000000001';
ALTER TABLE standards ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE standards DROP CONSTRAINT standards_pkey;
ALTER TABLE standards ADD PRIMARY KEY (workspace_id, term_id);
