-- MAS-94: passages the prompt-injection guardrail withheld are never graded.
-- The review records how many, so the coverage line can say "n checked,
-- k withheld" instead of letting withheld read as clean.
ALTER TABLE risk_reviews ADD COLUMN IF NOT EXISTS chunks_withheld integer NOT NULL DEFAULT 0;
