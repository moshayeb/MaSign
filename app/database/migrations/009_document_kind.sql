-- MAS-107: is the file a commercial contract at all? Classified by rule at
-- upload (app/ingestion/document_type.py); rows from before this migration
-- are classified from their stored chunks at the next startup (NULL = not yet).
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_kind TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_looks_like TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS document_kind_reasons JSONB NOT NULL DEFAULT '[]'::jsonb;
