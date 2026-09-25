-- MAS-139: a bare chunk index is ambiguous when linked documents both have
-- passage 0. Existing rows were solo reviews, so their reviewing contract is
-- the correct source document for the one-time backfill.
UPDATE risk_reviews AS review
SET unreadable_chunks = COALESCE((
    SELECT jsonb_agg(jsonb_build_object('contract_id', review.contract_id, 'chunk_index', (item.value #>> '{}')::integer) ORDER BY item.ordinality)
    FROM jsonb_array_elements(review.unreadable_chunks) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) = 'number'
), review.unreadable_chunks);

UPDATE risk_reviews AS review
SET withheld_chunks = COALESCE((
    SELECT jsonb_agg(jsonb_build_object('contract_id', review.contract_id, 'chunk_index', (item.value #>> '{}')::integer) ORDER BY item.ordinality)
    FROM jsonb_array_elements(review.withheld_chunks) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) = 'number'
), review.withheld_chunks);

UPDATE risk_reviews AS review
SET redacted_chunks = COALESCE((
    SELECT jsonb_agg(jsonb_build_object('contract_id', review.contract_id, 'chunk_index', (item.value #>> '{}')::integer) ORDER BY item.ordinality)
    FROM jsonb_array_elements(review.redacted_chunks) WITH ORDINALITY AS item(value, ordinality)
    WHERE jsonb_typeof(item.value) = 'number'
), review.redacted_chunks);
