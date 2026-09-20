-- MAS-99: passages that were graded minus their injected sentences. Listed so
-- the user can see which passages the model read only in part.
ALTER TABLE risk_reviews ADD COLUMN IF NOT EXISTS redacted_chunks JSONB NOT NULL DEFAULT '[]'::jsonb;
