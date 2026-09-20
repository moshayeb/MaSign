-- MAS-84: coverage is part of every result. What ingestion could not read
-- lives with the contract; which passages the review could not grade (and
-- which the guardrail withheld) live with the review, as lists, so the user
-- can read them by hand instead of trusting a count.
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS ingestion_notes JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE risk_reviews ADD COLUMN IF NOT EXISTS unreadable_chunks JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE risk_reviews ADD COLUMN IF NOT EXISTS withheld_chunks JSONB NOT NULL DEFAULT '[]'::jsonb;
