-- MAS-143 (Tier 3): user accounts, personal workspaces, sessions and an
-- immutable audit trail. Personal-workspace-only for now, but membership is
-- a real join table (not a column on users) so a future team/sharing model
-- needs only a relaxed assumption, not a new table.

CREATE TABLE IF NOT EXISTS users (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         TEXT        NOT NULL DEFAULT 'owner',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members (user_id);

-- Opaque bearer token, not a JWT: logout is one DELETE, a real revocation
-- rather than waiting out a signed token's expiry.
CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT        PRIMARY KEY,
    user_id    UUID        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- Immutable log: upload, link/unlink, review requested/completed/failed,
-- export. user_id is NULL for a system-completed event (a background review
-- finishing), never for one a person requested -- that distinction is the
-- whole point of this table (MAS-143 acceptance criteria).
CREATE TABLE IF NOT EXISTS audit_events (
    id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID        NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      UUID        REFERENCES users (id) ON DELETE SET NULL,
    event_type   TEXT        NOT NULL,
    target_type  TEXT        NOT NULL,
    target_id    UUID,
    metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_events_workspace ON audit_events (workspace_id, created_at DESC);

-- Backfill: every contract/question that existed before workspaces did goes
-- into one fixed, deterministic legacy workspace -- never inferred per-row
-- from a filename or a link (explicitly ruled out by this ticket).
INSERT INTO workspaces (id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Legacy demo workspace')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE;
UPDATE contracts SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL;
ALTER TABLE contracts ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contracts_workspace ON contracts (workspace_id);

-- questions.workspace_id: a no-scope ("all contracts") question has no
-- contract_id to join through, so it needs its own workspace column to be
-- scoped at all (MAS-102's all-contracts questions).
ALTER TABLE questions ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES workspaces (id) ON DELETE CASCADE;
UPDATE questions SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL;
ALTER TABLE questions ALTER COLUMN workspace_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_questions_workspace ON questions (workspace_id);
