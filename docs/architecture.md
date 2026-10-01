# Architecture Notes

The service is organized around a contract review workflow:

1. `app/ingestion` loads contracts, extracts text, chunks clauses, and prepares metadata.
2. `app/retrieval` embeds chunks and retrieves relevant context for user questions.
3. `app/risk_analysis` evaluates retrieved clauses for legal, operational, and commercial risk.
4. `app/actions` turns analysis outputs into review tasks or downstream workflow actions.
5. `app/database` stores contracts, chunks, analyses, and review state.

## Database

Postgres holds three tables: `contracts` (one row per upload), `chunks` (one
row per text chunk, FK to its contract with cascade delete; `embedding_id`
links the chunk to its vector in Qdrant) and `vector_index` (one row per Qdrant
collection recording the embedder it was built with). The schema lives in numbered SQL
files under `app/database/migrations/`; `run_migrations()` applies any not
yet recorded in `schema_migrations` and runs on API startup, so
`docker compose up --build` always brings a fresh database to the current
schema. `app/database/repository.py` is the only module that issues SQL.
Every table with a contract's data (`chunks`, `risk_reviews`, `key_terms`,
`questions`, `contract_links`) has cascaded from `contracts` since it was
added, so `DELETE /api/contracts/{id}` (MAS-126, exposing what was
previously only an internal failed-upload cleanup, `repository.delete_contract`)
is a single Postgres delete plus a best-effort Qdrant cleanup — no per-table
cleanup code to keep in sync.

## Embeddings and vector store

`app/retrieval/embeddings.py` has two implementations of one `Embedder`
protocol, chosen by `EMBEDDING_BACKEND` (MAS-61): `sentence-transformers` runs
the `EMBEDDING_MODEL` in-process (default: Free Law's legal-fine-tuned
ModernBERT; see CLAUDE.md for the benchmark behind that choice) on the CPU or,
with `EMBEDDING_DEVICE=auto|cuda` and a CUDA torch build, the GPU;
`openai-compatible` calls a `/v1/embeddings` endpoint at `EMBEDDING_API_URL`
(the `quality` profile's `llama-server` hosting Qwen3-Embedding-4B, see
`docker-compose.quality.yml`), learns the dimension from the first vector and
counts tokens exactly through llama-server's `/tokenize` — or, for a server
without it, through the Hugging Face tokenizer named by `EMBEDDING_TOKENIZER`;
with neither it refuses to start rather than estimate (MAS-63). Either way the
embedder owns the model's input format: the ModernBERT/nomic family expects
`search_document: ` / `search_query: ` prefixes and Qwen3-Embedding a query-side
instruction, which it adds itself so no caller has to know. It also exposes
`count_tokens`/`max_tokens`, and the upload route hands those to the chunker as a
`TokenBudget` so every chunk fits the model's sequence limit — characters alone
are not a safe proxy (number-dense clauses reach ~0.45 tokens/char). An oversized
text reaching `embed_documents` is a bug and raises rather than being truncated.
An unreachable embedding service is a 503 (`EmbeddingServiceError`) during a
request and fatal at startup for the required `portable` profile.

`app/retrieval/vector_store.py` keeps one Qdrant collection per profile —
`contract_chunks` for `portable` (the pre-MAS-62 name, unchanged so an
existing deployment's collection is never silently orphaned) and
`contract_chunks_quality` for `quality` by default — where each point's id
**is** the chunk's Postgres UUID (the same id in both collections; only the
vector differs) and the payload carries `contract_id`, `chunk_index` and
`text`. On upload, `app/retrieval/indexing.py`'s `index_contract()` embeds
the stored chunks, upserts them and writes the point id back to
`chunks.embedding_id`; if the required `portable` call fails the contract is
removed from both stores again so nothing unsearchable lingers.

### Compare mode (MAS-62)

`get_embedder(profile)` / `get_vector_store(profile)` are `lru_cache`d per
profile (`"portable"` or `"quality"`), not the pre-MAS-62 bare singletons —
both profiles can be live in the same process at once. `quality`'s settings
are the same `EMBEDDING_*`/`QDRANT_COLLECTION` names with a `QUALITY_`
prefix, entirely independent of `portable`'s (`embeddings.is_profile_configured
("quality")` is false, and nothing else about the app changes, unless
`QUALITY_EMBEDDING_API_URL` is set — MaSign never guesses an operator's GPU
server address). `docker-compose.quality.yml` is unrelated and unchanged: it
still *replaces* the plain `EMBEDDING_*` config for a quality-only
deployment; the `QUALITY_*` variables are the additive surface for running
both at once.

Every upload indexes the required `portable` profile as before, then,
best-effort, `quality` if configured — its failure is logged and reported on
the upload response (`indexed_profiles`, and a `contracts.indexed_profiles`
column, migration 014) but never fails the upload or rolls back the portable
indexing already committed to Qdrant (caught inside the request handler, not
allowed to propagate, since Postgres only commits the whole request's writes
together — an uncaught exception there would have rolled back the successful
`portable` write too, orphaning its already-upserted Qdrant vectors). Chunks
are stored once and chunked to one token budget at upload time (`portable`'s,
the required profile); Qwen3-Embedding-4B's much larger context means those
same chunks are automatically valid for `quality` too, so this is a
deliberate choice, not an oversight — a hypothetical `quality` profile with a
*smaller* max_tokens than `portable` would simply fail indexing for that
profile (`EmbeddingInputTooLong`, caught the same way).

`POST /api/query`'s `profile` field (default `portable`) selects which
collection `_retrieve()` searches; requesting `quality` when it is not
configured, or for a specific contract never indexed into it, is a 409 —
Qdrant's own point count for that contract is the source of truth
(`store.count(contract_id=...)`), not a separate "was this indexed" flag that
could drift from it. The response echoes back which profile actually
answered so the UI never has to assume.

`app/retrieval/retriever.py` answers `/api/query`: it embeds the question (query
prefix applied by the embedder), searches the collection — filtered to one
contract when `contract_id` is given — and returns the top `limit` hits, best
first, dropping any whose contract no longer exists in Postgres (a failed
upload's Qdrant cleanup is best effort). The response carries each hit's
`chunk_id`, `contract_id`, `chunk_index`, `text` and cosine `score`, so the UI
can cite the exact clause and the answer step (MAS-13) can quote it. Verified
against `data/sample_contracts/northwind_master_services_agreement.txt`: eight
questions, including four on financial terms, all rank the right clause first.

**What's retrieved, in plain terms (teacher question, 2026-09-25):** the
corpus is not one fixed collection — it is whatever the current user has
uploaded, one Qdrant point per chunk (~512 tokens each, see the token-budget
chunking above), retrieved by cosine similarity. The UI always scopes a
question to the open contract (or its linked bundle, MAS-138); the API can
search across every stored contract when no `contract_id` is given, but the
frontend never calls it that way. Default `limit` is 5 (`DEFAULT_LIMIT`,
`app/retrieval/retriever.py`) — the top 5 chunks by cosine score, not the
whole document. As a snapshot, not a fixed number — it grows with usage: the
dev deployment held 29 contracts / 107 chunks total on 2026-09-25 (`curl
localhost:6333/collections/contract_chunks`); a real 30-page contract runs
roughly 10–20 chunks on its own, per the chunker's token budget.

At startup the API loads the model and compares the collection's recorded
fingerprint (`vector_index`: backend, model, dimension, token limit, prompt
format) with the configured embedder. Any difference — or a missing collection — rebuilds the
collection and re-embeds every chunk from Postgres, so switching models is a
config change with no re-upload.

## Answer generation

`app/answering/llm.py` defines the `ChatModel` protocol (`complete(system,
user, max_tokens)`) with two providers, Anthropic (default, `claude-sonnet-5`)
and OpenAI, chosen by `CHAT_PROVIDER`/`CHAT_MODEL`; switching is configuration
because nothing about the model is stored and the prompt is ours. With no API
key the app still starts (`UnconfiguredChatModel`) and `/api/query` answers
503 naming the variable to set; provider errors become `ChatModelError`, also
a 503 with the reason.

`app/answering/grounding.py` is the rule the tool rests on (MAS-13/14): the
passages are numbered `[1]..[n]` with their source file and position, the
system prompt allows only those passages and demands a `[n]` after every
factual sentence, and the model must answer `NOT_FOUND` when they do not
cover the question — which the API returns as the fixed "Not found in
contract." An empty retrieval never reaches the model. Citations in the reply
are parsed and resolved to the chunks. `grounded` also requires each detected
money amount, percentage, date and duration in the answer to occur in a cited
passage; an answer that fails either check is returned as unverified.

## Question history (MAS-102)

A `questions` row (migration 013) is written by `/api/query` after every
successful answer — `answered` or `not_found`, both real outcomes worth
keeping — but never for a refused one (`answer_status = 'withheld'`, meaning
the model was never asked). `contract_id` is nullable: a no-scope ("all
contracts") question is stored once, not duplicated per contract. `response`
holds the whole `QueryResponse` as JSONB, so `GET
/api/contracts/{id}/questions` can return a stored answer's citations, flags
and withheld notices exactly as they were, with no second model call.
`list_questions` matches a contract either directly (`contract_id` equals
it) or, for a no-scope question, by checking whether the stored `citations`
actually named that contract (a `jsonb_array_elements` query over
`response -> 'citations'`) — retrieval alone is not enough, since an
unscoped question searches every contract but may not have cited most of
them. `DELETE /api/questions/{id}` ("Forget") removes a row outright.

## Model calls and the prompt-injection guardrail (MAS-90)

`app/answering/llm.py` has one adapter, `LiteLLMChatModel`, which calls
`litellm.completion()` with `<provider>/<model>` (Anthropic by default,
OpenAI by config) and maps LiteLLM's exceptions to a readable
`ChatModelError`. `get_chat_model()` wraps it in `GuardedChatModel`
(`app/guardrails/prompt_injection.py`): every `complete()` builds the
LiteLLM request (`messages` + `metadata.passages`), runs the guardrail's
`async_pre_call_hook` on it — the same hook the LiteLLM proxy would run for a
registered guardrail — and sends what comes back. The hook withholds
contract passages that carry instructions addressed to the AI (numbering
kept, text replaced, warning with contract_id / chunk_index), refuses an
injected question outright, and reports the withheld passage numbers, which
`Completion.blocked` carries to the answer and to `/api/query`'s
`blocked_passages`. Since MAS-99 `redact_passage()` cuts only the injected
sentences (`sentence_spans()` splits on line breaks and `. ! ?` + space,
not after clause numbers); a passage with clean sentences left is read in
part and reported in `Completion.redacted` → `redacted_passages`, and the
review stores `redacted_chunks` (migration 008) as graded. `/passages`
returns `withheld_spans` so the reader can underline what was hidden. `withheld_labels()` runs the same detector *before* a
call so the answer and risk paths can see when nothing readable would
reach the model and skip the call: the answer is then `status: withheld`
(MAS-93) and the risk report `checked: false`; a withheld passage is never
counted as checked, so the report is incomplete and the whole-contract
review records it in `chunks_withheld` (MAS-94). Tests wrap the fake model
in the same guardrail, so the API tests exercise it without a key.

## Risk analysis

`app/risk_analysis/rubric.py` defines seven categories (liability cap,
termination, indemnification, auto-renewal, confidentiality, payment terms, IP
assignment) with High/Medium/Low criteria from the Customer's perspective;
`docs/risk-rubric.md` is generated from it. `analyzer.py` makes one model call
per query over the same numbered passages the answer used and asks for JSON
findings; each is kept only if its category and severity are in the rubric,
its passage exists and its quote appears verbatim in that passage. The call
runs in parallel with the answer. An unreadable reply yields
`risks_checked: false` rather than a reassuring empty list; a cut-off reply
keeps the findings that arrived whole and reports `risks_complete: false`
(MAS-80). `app/actions/workflow.py` turns the findings into suggested next
steps.

A verified quote can still carry a severity that contradicts the rubric's own
numeric boundary -- a live review once graded a 60-day mutual, fee-free
termination notice as Medium, when the rubric's Low band is explicitly
30-60 days (MAS-152). `severity_rules.py` corrects this one well-defined
case deterministically after quote verification, and only when the quote
itself makes the day count, mutuality and fee-free status unambiguous;
anything less clear (a one-sided clause, an unclear fee, no day count) is
left exactly as the model graded it, on the same honest-outcomes principle
as the rest of the review -- an unverifiable correction would be worse than
the bug it fixes.

`review.py` is the whole-contract review (MAS-81): after every upload a
background task sends all of the contract's chunks through the same
`analyze_risks` in batches of 8 and stores the verified findings in
`risk_findings` with a status row in `risk_reviews` (pending → running → done
| failed, model, passages checked, `complete`). It opens its own connection
because the request's one is closed by the time it runs. `GET
/api/contracts/{id}/risks` returns the findings grouped by the seven
categories; `POST .../review` atomically claims the review row before it
schedules the background task, so concurrent requests produce one 202 and
one 409 rather than two model jobs; the contract list carries `risk_status`,
`risk_worst_severity`, `risk_complete` and checked/total passage counts, so
an incomplete result cannot look clean.

**Which of the three approaches this is (teacher question, 2026-09-25):**
neither clause-by-clause with running memory, nor one call per rubric
category, nor a single big-bang prompt over the whole document. It's a
**batch sweep**: fixed windows of 8 chunks, and each call checks that window
against *all seven* rubric categories at once — batches exist only because a
full contract's chunks plus a useful reply wouldn't fit one call's token
budget. The real limitation this creates, stated rather than hidden: batches
are graded **independently** — nothing found in batch 1 is passed to the
model when it grades batch 4, so a clause whose risk only reads correctly
together with a definition several batches earlier could be misjudged.
Carrying a short summary of already-found findings into later batches would
close most of that gap; it isn't implemented (parked, not started).

## Key terms (MAS-82)

`app/key_terms/terms.py` defines the nine financial terms as data (id,
name, what to look for, and a `kind` that fixes the typed fields it may
carry); `extractor.py` asks the model for them per batch with the same
prompt shape and verification as the analyzer — verbatim quote from the
named passage or dropped, unreadable reply → `checked: false`, withheld
passages never read — plus `verify_typed()`, which keeps the typed object
only when it is well-formed for its kind and every number in it occurs in
the quote. `review.py` runs it right after `analyze_risks` for each batch
and stores rows in `key_terms` (one per verified term × passage, `typed`
as JSONB, migration 006) with `risk_reviews.key_terms_complete`. The API
(`GET /api/contracts/{id}/key-terms`, and `key_terms` inside `/risks`)
always returns all nine terms in order: `found` (value, quote, passage,
typed, `others`), `conflicting` (others disagree), `not_stated` (only when
the pass completed) or `unchecked`. `GET /api/contracts/{id}/passages`
returns the stored chunks in order for the frontend's contract-text reader
(MAS-83), so every finding, key term and citation is one click from the
text it quotes.

## Editable standards (MAS-120)

`app/key_terms/standards.py` compares a verified typed key term against a
rule, not a model call: `compare(term_id, typed, params)` returns `meets`,
`deviates`, `unknown` (stated, but not in a shape this standard can judge —
e.g. a percent-of-fees fee against an amount cap, or an amount in a currency
the standard isn't set in — MaSign never converts currencies or guesses) or
`none` (no standard for this term). `DEFAULT_PARAMS` is MaSign's built-in
position for the four numeric terms (payment deadline, late-payment
interest, notice period, termination cost); `describe(term_id, params)`
computes the one-line text from those numbers so it can never drift from
what is actually stored. Since MAS-120 a `standards` row (migration 014,
`params` JSONB) overrides a term's default; a term with no row uses the
default, and resetting removes the row rather than ever writing default
values back — the default lives in exactly one place. `compare()`/
`describe()`/`validate_params()` only ever take a `params` object; they have
never known about workspaces, profiles, or anything that feeds that object
to them — every layer below here is just about *which* `params` dict is in
scope.

### Named standard profiles (MAS-185)

MAS-181 (migration 016) scoped one `standards` override set per workspace.
MAS-185 (teacher question, 2026-10-01: *"Can the customer add standard sets
of aspects to be evaluated for the contract(s) or category of contracts?"*)
lets a workspace hold more than one named set and assign one per contract —
scoped deliberately to the existing 4 numeric terms, not the 7 risk-rubric
categories (parked as a separate, bigger decision; turning a category off
per profile risks hiding a real finding, which cuts against honest-outcomes)
and with no contract "category" field (v1 is manual per-contract assignment
only, consistent with MAS-107's rule that MaSign never guesses, only states
what is verified or user-set).

Migration 018 adds `standard_profiles` (`id`, `workspace_id`, `name`,
`is_default`, `UNIQUE(workspace_id, name)`) and repoints `standards` at it:
the table gains a `profile_id` column, loses `workspace_id` (redundant once
every row belongs to a profile that itself belongs to a workspace), and its
primary key becomes `(profile_id, term_id)`. Every workspace that already
had `standards` rows gets one profile named "Default" with `is_default =
true`, and its existing rows are re-pointed at it in the same migration — no
behaviour change for a workspace that upgrades. A workspace created *after*
MAS-185 (or one that never customised anything) has no `standard_profiles`
row at all until `repository.get_or_create_default_profile()` is called,
which creates its "Default" profile lazily on first read rather than
backfilling every future workspace up front.

`contracts.standard_profile_id` is a nullable FK with `ON DELETE SET NULL`:
`NULL` means "use the workspace's default profile," and deleting the
profile a contract is using clears that contract back to `NULL`
automatically — at the database level, so there is no app-level
reassignment step that could be skipped or raced (honest-outcomes: never a
dangling reference). `repository.delete_standard_profile()` separately
refuses (`ValueError` → 400) to delete the `is_default` profile itself —
a workspace always has exactly one to fall back to.

`app/api/routes.py`'s `/api/standards*` routes are unchanged in shape and
now operate on `get_or_create_default_profile(workspace_id)` under the
hood — true backward compatibility, not just an equivalent-looking new
surface: a pre-MAS-185 frontend or script calling them sees identical
behaviour. `/api/standard-profiles*` is the new, additive surface (list/
create/rename/set-default/delete a profile; read/write one profile's
standards; `PUT /contracts/{id}/standard-profile` to assign one).
`_standards_for_contract()` resolves a single contract's effective profile
(its own, or the workspace default); `list_contracts` batches this across a
whole page via `repository.get_standards_by_profiles()` — one query for
every *distinct* profile a page of contracts actually uses, not one query
per contract. Either way, the resolved `params` dict threads into
`ContractSummary`, `KeyTermValue` and `KeyTermsResponse` exactly as before,
so a profile switch changes every deviation shown — the Overview tab's
count, the key-terms list, the export — immediately, with no re-review and
no model call, the same MAS-120 guarantee extended across profiles.

The UI: `pages/Standards.tsx` is now a profile picker (tabs: one per
profile, "+ New profile", rename/make-default/delete for the selected
non-default profile) above the same four-card standards grid, now scoped to
whichever profile is selected. `components/KeyTermsCard.tsx` grew a
`StandardProfilePicker` next to the "Key terms" heading — a `<select>`
of the workspace's profiles plus "Workspace default" — that only renders
once more than one profile exists, so a workspace that never created a
second profile sees no new UI at all.

### Expected-clause checklist (MAS-188)

Split from MAS-98's post-course grab-bag: for a fixed catalog of clauses
(liability cap, data protection, insurance, indemnification —
`app/key_terms/clauses.py`, the same shape as `key_terms/terms.py`), show
present / absent / cannot-tell per clause, with a verbatim-quoted source
passage when present. Which clauses apply is a property of a standard
profile (MAS-185), the same way the 4 numeric terms are: migration 019 adds
`disabled_profile_clauses(profile_id, clause_id)` — a missing row means
enabled, the same "absence = default" discipline `standards` already uses,
so every profile (existing or new) starts with the full catalog checked with
no backfill needed. `repository.get_disabled_clauses()`/
`set_profile_clause_enabled()` and `/api/standard-profiles/{id}/clauses*`
mirror the standards routes exactly; `pages/Standards.tsx` renders them as a
checkbox list below the four-card standards grid.

Detection folds into the existing whole-contract review job
(`risk_analysis/review.py`) as a **third independent model call per batch**,
mirroring MAS-82/MAS-129 exactly: `risk_analysis/clause_checker.py`'s
`check_clauses()` has its own try/except, its own `clauses_complete` flag,
and its own verbatim-quote verify-or-drop gate (reusing `analyzer._normalise`
and the salvage/parse helpers) — a clause-check failure never discards that
batch's (or any prior batch's) already-verified risk findings or key terms,
and never marks the whole review "failed". This was a corrected decision: an
earlier framing of "fold into the existing pass" as zero-additional-cost was
wrong (MAS-82 itself added a whole call per batch for key terms, so this adds
a third — Northwind: 4 → 6 calls/upload), caught and corrected with the owner
before implementation rather than after. Zero-cost cases still exist: a
profile with every clause disabled, or a batch fully withheld by the
guardrail, short-circuit `check_clauses()` before any model call.

`ClauseResult.from_rows()` (`app/api/routes.py`) computes `present` (any
verified row — `others` lists further passages, no "conflicting" status
since presence has no comparable value to disagree over), `absent` (no rows,
`clauses_complete` true), or `cannot_tell` (no rows, pass incomplete) —
`clauses_complete` requires `review.status == "done"` first, same gate
`key_terms_complete` already needs. `RiskReviewResponse.from_models()` only
lists the clauses the contract's effective profile has enabled (resolved by
`_enabled_clauses_for_contract()`, mirroring `_standards_for_contract()`).
`components/ClauseChecklistCard.tsx` renders it inside the Overview tab's
"View complete analysis" fold, right after `KeyTermsCard` — same tile shape,
same `sourceInfo()`-style document attribution for a bundle's linked
documents (MAS-190's pattern).

## Coverage (MAS-84)

`extract_document()` in `ingestion/parsing.py` returns the text plus
`notes` (pages with no text layer, characters removed), stored as
`contracts.ingestion_notes` (migration 007). `review.py` records
`unreadable_chunks` and `withheld_chunks` on the review row as document and
passage locations, not only counts. `ingestion/references.py` finds
documents the text refers to but does not contain (schedule / exhibit /
annex / appendix / attachment / addendum + letter or number, Order Form,
Statement of Work, SLA, Purchase Order; a heading at a line start counts as
present). The API assembles these into `coverage` on the review and
key-terms responses. A `contract_links` row (migration 010) explicitly
resolves a named reference to an uploaded document; the review uses the
primary contract plus those linked documents. Other references are computed
from the bundle chunks on each read and remain clearly marked as not uploaded.
The link is only one level deep: a document linked to a primary agreement does
not automatically pull in documents linked from that second document. Each
review record belongs to its primary contract, while findings, terms, coverage
locations, citations, and exports retain the source contract id of the chunk
that produced them. Removing a link invalidates the primary review rather than
leaving it to claim coverage of the former bundle.

## Document kind (MAS-107)

`ingestion/document_type.py` — `classify_document(text) -> DocumentKind(kind,
looks_like, reasons)` — runs on the extracted text in the upload route, by
rule (regex marker lists, distinct hits counted, thresholds 4 / 3 / 40
words), and the result is stored on `contracts` as `document_kind`,
`document_looks_like`, `document_kind_reasons` (migration 009).
`repository.classify_unclassified_contracts()` runs in `lifespan` after
`ensure_index_current` and classifies rows with `document_kind IS NULL`
from their chunks, once. The kind travels on `ContractSummary` (list and
upload), on `Coverage` (review and key-terms responses) and into the
Markdown export. Nothing branches on it server-side: it is information for
the reader, never a gate.

## Invoice verification (MAS-92)

A separate, minimal pipeline from the contract one — an invoice is never
indexed for search and never gets a commercial-contract risk review.
`app/invoices/parsing.py` extracts a digital PDF invoice's text page by page
(`extract_invoice`), keeping page boundaries rather than flattening them the
way `ingestion/parsing.py` does for contracts, so a citation can point at a
page; a PDF with no text layer on any page raises
`NoExtractableInvoiceTextError` (422) rather than producing an empty or
falsely "clean" result — OCR is out of scope for this story.
`app/invoices/fields.py` defines the header fields (`invoice_number`,
`invoice_date`, `due_date`, `total_amount`, `late_fee_rate`) with the same
`kind` typing as `key_terms/terms.py` (money, date, rate, text — the field
kinds this module was prepared for, owner decision 2026-09-18); line-item
tables are explicitly out of scope and are never shown to the model.
`app/invoices/extractor.py` asks the model for these fields with one call
per invoice, verified exactly like key terms: verbatim quote from the named
page or dropped, an unreadable reply is `checked: false` (never "nothing
stated"), and `app.key_terms.extractor.verify_typed` is reused unchanged for
the typed values.

`app/invoices/comparison.py` compares the extracted fields against
`repository.list_key_terms(contract_id)` — already bundle-aware (MAS-137/138),
so a fee or payment clause living in a linked Order Form/SOW is found the
same way the risk review finds one; the invoice itself is never added to a
contract's bundle. Three outcomes only: `match`, `possible_mismatch` (both
sides' quotes shown) or `cannot_verify` — used for a missing value on either
side, a currency mismatch, a recurring contract fee compared against a single
invoice total with no stated billing period (pro-rating is never assumed
away), or a late-payment rate expressed two different ways (percentage vs.
fixed fee). `cannot_verify` is also what every item becomes when the
invoice's own fields could not be read at all (`checked: false`) — never a
silent "clean" result.

Storage (migration 017): `invoices` (workspace- and contract-scoped),
`invoice_chunks` (one row per readable page, `chunk_index` is the real PDF
page number), `invoice_checks` (one row per comparison run — re-checking adds
a new row rather than overwriting, same as risk reviews), and
`invoice_check_items` (one row per compared item, carrying both sides'
value/quote/chunk so a mismatch is never shown without the evidence behind
it). `POST /api/contracts/{id}/invoices` runs the whole pipeline inline (one
short model call, not a polled background job) and returns the persisted
result; `GET .../invoice-checks` lists past runs, `GET
/api/invoices/{id}/pages` serves the stored page text for citation. Every
contract-side lookup goes through the workspace-scoped `repository.get_contract`
pair (MAS-143): a cross-workspace contract or invoice id 404s exactly like a
missing one.

## Accounts, workspaces and the audit trail (MAS-143)

Tier 3 of the ticket: internal accounts (email + Argon2id-hashed password,
`app/auth/security.py`), personal workspaces, and an immutable audit log —
pulled forward from the backlog by owner sign-off (2026-09-28), overriding
the "do not start during Sprint 3" note it originally shipped with. Personal
workspaces only: every account gets exactly one, created in the same
transaction as the account (`repository.create_personal_workspace`), with no
teams or sharing. `workspace_members` is still a real join table rather than
a column on `users`, so a future team model needs only a relaxed uniqueness
assumption, not a new table.

**Sessions** (migration 014: `users`, `workspaces`, `workspace_members`,
`sessions`, `audit_events`) are an opaque `secrets.token_urlsafe(32)` looked
up in Postgres, not a signed JWT: `POST /api/auth/logout` deletes the row, a
real revocation, rather than waiting out a token's own expiry. The cookie is
`HttpOnly`, `SameSite=Lax`, and `Secure` unless `MASIGN_COOKIE_SECURE=0` —
`Secure` is unusable over plain HTTP, so local dev (and the test suite, which
talks to `TestClient`'s `http://testserver`) needs the flag off; a real
deployment's default stays on.

**Workspace scoping is enforced in `repository.py`'s SQL, not filtered after
the fact in the route layer**: `get_contract`, `list_contracts`,
`list_contract_ids`, `create_question` and `list_questions` all take a
`workspace_id` and filter or stamp it directly. A contract (or question, or
link target) in another workspace is *indistinguishable from one that does
not exist* — every route returns 404, never a 403 that would confirm the id
is valid but belongs to someone else. Two internal, unscoped functions exist
for trusted callers that have no request/workspace context of their own —
`get_contract_by_id` (the background review job, `risk_analysis/review.py`)
and `list_all_contracts` (the startup vector-index rebuild,
`retrieval/indexing.py`) — and neither is ever called from an HTTP route.
Child tables reached through an already-validated `contract_id` within the
same request (chunks, risk findings, key terms, links) are not re-scoped a
second time; the ownership check happens once, at the route's own
`get_contract`/`get_current_workspace` call, the same "validate at the
boundary" pattern most request-scoped web frameworks use.

`GET /api/query`'s no-scope ("all contracts") search is scoped through
`retrieve_contract_context`'s `workspace_id` parameter, which resolves to
`list_contract_ids(db, workspace_id)` — a question asked with no
`contract_id` only ever searches the caller's own contracts. Because a
no-scope question has no `contract_id` of its own to join through,
`questions.workspace_id` is a real column (not derived), stamped at write
time and filtered on every read.

**Audit events** (`audit_events`, workspace_id + nullable user_id +
event_type + target) are written for upload, link, unlink, review
requested/completed/failed, matching the ticket's acceptance criteria that
audit records distinguish a system outcome from a person's action:
`user_id` is set for anything a signed-in caller triggered (upload, link,
unlink, requesting a review) and left `NULL` for a background job's own
outcome (a review's `review.completed`/`review.failed`, written from
`risk_analysis/review.py` with no request context to attribute it to).

**Known, accepted gaps for this course-quality tier** (all explicitly listed
as out of scope by the ticket's own tier boundary, not oversights): no email
verification on registration, no password reset, no login rate limiting, no
teams/sharing. The two contracts already in the live demo database before
this migration ran were backfilled into one fixed "Legacy demo workspace"
(`00000000-0000-0000-0000-000000000001`) — never inferred per-row from a
filename or a link.

The current implementation is a scaffold. The module boundaries are intentionally narrow so each stage can be replaced with production infrastructure without reshaping the API surface.
