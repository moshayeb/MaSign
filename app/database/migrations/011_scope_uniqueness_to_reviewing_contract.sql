-- MAS-138: a chunk belonging to a linked document (MAS-137) can now be
-- graded twice -- once as part of a bundle review, stored under the primary
-- contract's id, and once in that document's own independent review when
-- opened solo. The old UNIQUE(chunk_id, category) / UNIQUE(chunk_id, term)
-- matched across reviewing contracts, not within one: the second review's
-- INSERT ... ON CONFLICT DO NOTHING would silently be dropped by the
-- first's row, and the finding/term would appear to belong to the wrong
-- contract. Scope both to the reviewing contract_id too, so a bundle review
-- and a solo review of the same chunk never contend for the same row.
ALTER TABLE risk_findings DROP CONSTRAINT IF EXISTS risk_findings_chunk_id_category_key;
ALTER TABLE risk_findings ADD CONSTRAINT risk_findings_contract_chunk_category_key UNIQUE (contract_id, chunk_id, category);

ALTER TABLE key_terms DROP CONSTRAINT IF EXISTS key_terms_chunk_id_term_key;
ALTER TABLE key_terms ADD CONSTRAINT key_terms_contract_chunk_term_key UNIQUE (contract_id, chunk_id, term);
