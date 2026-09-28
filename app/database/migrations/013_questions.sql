-- MAS-102: stored answers reappear on the Ask tab instead of living only in
-- the browser session, so a reviewer coming back to a contract (or a demo
-- the next day) does not repeat a call it already paid for. contract_id is
-- nullable: an "all contracts" question (no scope) is stored once and shown
-- under any contract it actually cited, rather than duplicated per contract.
-- response holds the full QueryResponse as sent, so a stored answer's
-- citations, flags and withheld notices render exactly as they did live,
-- with no second model call. Only a successful answer is stored -- never a
-- refused one (answer_status = 'withheld', the model was never asked).
CREATE TABLE IF NOT EXISTS questions (
    id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contract_id   UUID        REFERENCES contracts (id) ON DELETE CASCADE,
    question      TEXT        NOT NULL,
    answer        TEXT        NOT NULL,
    answer_status TEXT        NOT NULL,
    grounded      BOOLEAN     NOT NULL,
    model         TEXT,
    response      JSONB       NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_questions_contract ON questions (contract_id);
