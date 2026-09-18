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
request and fatal at startup.

`app/retrieval/vector_store.py` keeps one Qdrant collection, `contract_chunks`,
where each point's id **is** the chunk's Postgres UUID and the payload carries
`contract_id`, `chunk_index` and `text`. On upload, `app/retrieval/indexing.py`
embeds the stored chunks, upserts them and writes the point id back to
`chunks.embedding_id`; if that fails the contract is removed from both stores
again so nothing unsearchable lingers.

`app/retrieval/retriever.py` answers `/api/query`: it embeds the question (query
prefix applied by the embedder), searches the collection — filtered to one
contract when `contract_id` is given — and returns the top `limit` hits, best
first, dropping any whose contract no longer exists in Postgres (a failed
upload's Qdrant cleanup is best effort). The response carries each hit's
`chunk_id`, `contract_id`, `chunk_index`, `text` and cosine `score`, so the UI
can cite the exact clause and the answer step (MAS-13) can quote it. Verified
against `data/sample_contracts/northwind_master_services_agreement.txt`: eight
questions, including four on financial terms, all rank the right clause first.

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
are parsed and resolved to the chunks; an answer that cites nothing is still
returned but `grounded: false`, so the UI can flag it and MAS-32 can count it.

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
`blocked_passages`. `withheld_labels()` runs the same detector *before* a
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

`review.py` is the whole-contract review (MAS-81): after every upload a
background task sends all of the contract's chunks through the same
`analyze_risks` in batches of 8 and stores the verified findings in
`risk_findings` with a status row in `risk_reviews` (pending → running → done
| failed, model, passages checked, `complete`). It opens its own connection
because the request's one is closed by the time it runs. `GET
/api/contracts/{id}/risks` returns the findings grouped by the seven
categories; `POST .../review` re-runs it (409 while one is running); the
contract list carries `risk_status` and `risk_worst_severity`.

The current implementation is a scaffold. The module boundaries are intentionally narrow so each stage can be replaced with production infrastructure without reshaping the API surface.
