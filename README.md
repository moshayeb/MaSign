# MaSign

MaSign is an AI-powered contract analysis assistant that helps users understand contracts faster. It is designed to make long, technical agreements easier to explore by combining document management, semantic search, question answering, and contract-risk analysis.

The application is not intended to replace a lawyer or make final legal decisions. Its purpose is to provide a useful first analysis, highlight clauses that deserve attention, and help users locate the original contract passages behind an answer.

## What It Does

A user uploads a contract, and the system should process it through several stages:

1. Read and process the uploaded document.
2. Divide the contract into smaller, meaningful sections.
3. Store the contract and its basic metadata.
4. Convert contract text into embeddings for semantic search.
5. Let users ask natural-language questions about the contract.
6. Identify potentially risky clauses and explain why they may matter.

Example questions include:

- What are the termination conditions?
- Is there an automatic renewal clause?
- What penalties can be charged?
- Who is responsible if something goes wrong?
- Are there unusual payment terms?

## Problem It Solves

Contracts are often long, technical, and time-consuming to review. Important obligations, deadlines, penalties, and risk terms can be hidden across many pages. This assistant helps users perform an initial review more quickly by finding relevant sections, explaining them in plain language, and pointing back to the source text.

## Intended Users

- Small businesses reviewing supplier or customer contracts
- Employees trying to understand employment agreements
- Project managers checking obligations and deadlines
- Legal teams performing an initial contract review
- Anyone comparing multiple agreements

## Example Scenario

A company uploads a 30-page supplier agreement. The assistant finds a clause allowing automatic renewal, identifies a large late-payment penalty, and shows the sections describing how the agreement can be terminated. The user can then examine those exact passages or take them to a lawyer.

## Local Setup

The API needs Postgres and Qdrant; the easiest way to get them is the compose
file, running only those two services:

```bash
docker compose up -d postgres qdrant

python -m venv .venv
source .venv/bin/activate        # Windows Git Bash: source .venv/Scripts/activate
pip install -r requirements.txt
cp .env.example .env             # loaded automatically at startup; edit if your ports differ
uvicorn app.main:app --reload
```

On startup the API applies any pending database migrations, then serves at
`http://localhost:8000` (the root redirects to the interactive docs at `/docs`).
If Postgres isn't reachable the API refuses to start and says so.

## Docker Services

```bash
docker compose up --build
```

The compose file starts three services:

| Service    | Container         | Host port | Notes                                        |
|------------|-------------------|-----------|----------------------------------------------|
| `api`      | `masign-api`      | 8000      | FastAPI app, waits for Postgres to be healthy |
| `postgres` | `masign-postgres` | 5433      | Dev-only credentials (`rag_user`/`rag_password`); 5433 on the host to avoid clashing with a native PostgreSQL on 5432 |
| `qdrant`   | `masign-qdrant`   | 6333/6334 | Vector store                                  |

Inside the compose network the API reaches the other services by name
(`postgres`, `qdrant`); `docker-compose.yml` overrides `DATABASE_URL` and
`VECTOR_STORE_URL` accordingly. A local `.env` is loaded if present (for
`OPENAI_API_KEY` etc.) but is not required to start the stack.

Check it is up:

```bash
curl http://localhost:8000/health
```

Then open **http://localhost:8000** — the web UI (built into the image from
`frontend/`) lets you upload a contract, pick it, and ask questions: the
answer cites the passages it came from (click a `[n]` to see the quote) and
is marked *Unverified* when it is not fully backed by them. Every action
reports its outcome in a toast, errors with the API's own message. The
interactive API docs stay at `/docs`.

### Embedding profiles

The deployer picks one of two profiles (benchmark and rationale in `CLAUDE.md`,
MAS-58). Switching changes the index fingerprint, so on the next start the
vector index is rebuilt automatically from the stored chunk text — nothing has
to be re-uploaded.

| Profile | Command | Model | Needs | ≈ 30-page contract |
|---|---|---|---|---|
| `portable` (default) | `docker compose up` | ModernBERT (legal fine-tune), in-process | any laptop; first start downloads ~600 MB into `hf_cache` | ~30 s on CPU, ~5 s on a GPU |
| `quality` | `docker compose -f docker-compose.yml -f docker-compose.quality.yml up` | Qwen3-Embedding-4B Q4_K_M via `llama-server` | NVIDIA GPU with ≥3 GB free VRAM, CUDA 12.x driver, Docker GPU access; first start downloads a 2.5 GB GGUF into `llama_models` | ~25 s on a 4 GB Quadro P1000 (3.7 GB VRAM in use) |

The `api` container ships CPU-only torch, so the `portable` profile runs on
the CPU there; running the API natively with a CUDA torch build and
`EMBEDDING_DEVICE=auto` (or `cuda`) uses the GPU. The `quality` profile
sets `EMBEDDING_BACKEND=openai-compatible` and points `EMBEDDING_API_URL` at
the `llama-server` service; any server speaking the OpenAI embeddings API
works the same way — one without llama-server's `/tokenize` endpoint also
needs `EMBEDDING_TOKENIZER` (the model's Hugging Face tokenizer) so token
counts stay exact (`.env.example` lists every setting). Both profiles serve
the same API, so nothing else changes.

## API Endpoints

Interactive docs at `http://localhost:8000/docs`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/contracts/upload` | Upload a TXT/PDF/DOCX contract; parses, chunks and stores it. Returns the `contract_id`. |
| `GET`  | `/api/contracts` | List stored contracts, newest first. |
| `GET`  | `/api/contracts/{contract_id}` | One contract's metadata (404 if unknown). |
| `POST` | `/api/query` | `{"question", "contract_id"?, "limit"?}` → `answer` written only from the retrieved passages, with `[n]` citations resolved in `citations`; `grounded` is false when the answer is "Not found in contract." or cites nothing. `retrieved_context` lists every passage considered, best first. Omit `contract_id` to search every contract. Needs `ANTHROPIC_API_KEY` (or `CHAT_PROVIDER=openai` + `OPENAI_API_KEY`); otherwise 503 with the reason. |
| `GET`  | `/health` | Liveness check. |

## Running the Tests

```bash
pytest
```

Frontend (from `frontend/`, needs Node 24): `npm ci`, then `npm test` and
`npm run build`; `npm run dev` serves the UI on :5173 with `/api` proxied to
a locally running API. See `frontend/README.md`.

Tests that need Postgres use a separate `contract_rag_test` database, created
automatically from `DATABASE_URL` and emptied after each test — your dev data
is never touched. Without a reachable Postgres they are skipped; set
`MASIGN_REQUIRE_DB=1` (as CI does) to make that a failure instead.

## Development Workflow

Work is tracked in Jira project [MAS](https://moshayeb.atlassian.net/jira/software/projects/MAS/boards/100/backlog),
three one-week sprints (Mon–Fri): Sprint 1 and 2 build the product, Sprint 3
is verification only.

- One branch per Jira story, named `MAS-<n>-short-slug` (e.g. `MAS-8-upload-endpoint`).
- Commit messages start with the issue key: `MAS-8: add upload validation`.
- Merge to `main` via a pull request once the story's "Done when" criteria are met,
  then move the Jira issue to Done. Branch and commit names containing the key
  show up automatically in the issue's Development panel via the GitHub for Jira app.
- CI (`.github/workflows/ci.yml`) runs `pytest` and a Docker build on every push and PR to `main`.
- UI work follows [docs/frontend.md](docs/frontend.md): React + Vite, and **sonner**
  toasts for every user action, with error toasts showing the API's `detail` message.
