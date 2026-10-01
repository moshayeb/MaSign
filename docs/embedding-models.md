# Embedding model comparison

Consolidates the CPU quality benchmark (MAS-11) and the GPU speed/VRAM
benchmark (MAS-58) into one table — they were run separately, on the same 12
Northwind chunks / 18 questions (10 on fees, penalties and payment terms), and
are shown here side by side for the first time. Full rationale for each
decision stays in `CLAUDE.md`; this page exists to answer "how do the models
compare" without piecing it together from two separate write-ups.

| Model | Backend / precision | Device | MLEB contract score | ≈ 30-page contract | Query latency | VRAM | Top-1 (18-Q eval) |
|---|---|---|---|---|---|---|---|
| ModernBERT (legal fine-tune) | sentence-transformers, fp32 | CPU | 0.741 | ~31 s | 97 ms | – | 16/18 |
| ModernBERT (legal fine-tune) | sentence-transformers, fp32 | GPU | 0.741 | ~5 s | 48 ms | 0.7 GB | 16/18 |
| Qwen3-Embedding-0.6B | sentence-transformers, fp32 | GPU | 0.766 | ~27 s | 180 ms | 1.6 GB | 16/18 |
| Qwen3-Embedding-0.6B | llama.cpp GGUF, F16 | GPU | not re-measured (see caveat) | 7.4 s | 193 ms | 2.35 GB | 15/18* |
| Qwen3-Embedding-0.6B | llama.cpp GGUF, Q8_0 | GPU | not re-measured (see caveat) | 6.8 s | 71 ms | 1.2 GB | 15/18* |
| Qwen3-Embedding-4B | llama.cpp GGUF, Q4_K_M | GPU | — (not re-measured at this quantisation; see caveat) | ~100 s isolated / ~25 s in compose (parallel batching) | ~178 ms isolated / 160–240 ms in compose | 2.7 GB isolated / ~3.7 GB in compose | 16/18 |
| OpenAI text-embedding-3-small | hosted API | – | 0.742 | — | — | — | not GPU-benchmarked (API-based) |

**Caveats, stated rather than smoothed over:**
- The 0.842 MLEB score CLAUDE.md cites for Qwen3-Embedding-4B is for the
  reference (non-quantised) weights — it has not been re-measured against the
  Q4_K_M GGUF actually deployed, so the two numbers should not be read as
  directly comparable. Quality was a tie on the one real contract tested
  (different near-misses, all rank 2–3); MLEB is the reason to expect 4B to
  win on harder cases, not a measured result for this exact build.
- Qwen models were never re-benchmarked on CPU after the first run showed it
  was impractical (~10.7 s/chunk, ~10 minutes for a 30-page contract) — that
  number is a CPU artefact, not a claim about the model, and is intentionally
  left out of this table rather than repeated.
- **MAS-184 (2026-10-01): the F16/Q8_0 rows above.** Measured with
  `llama-server` on the same dev P1000, `-hf Qwen/Qwen3-Embedding-0.6B-GGUF:F16`
  and `:Q8_0`, through the existing `openai-compatible` embedder path —
  no new infrastructure, as the earlier caveat said. Two things are marked
  `*` rather than compared directly to the older 16/18 rows: (1) the original
  18-question set behind every other row in this table was never committed
  to the repo (confirmed via `git show` of the MAS-58 commit, which touched
  only `CLAUDE.md`), so MAS-184 wrote a fresh 18-question set (10 on fees/
  payment/penalties) grounded in the same 12 Northwind chunks — same
  fixture, not the same questions, so 15/18 vs 16/18 is not a measured
  regression, it's a different ruler; (2) MLEB was not re-run against either
  quantisation — no MLEB harness exists in this repo, only the benchmark
  numbers CLAUDE.md records from when they were originally run elsewhere.
  Query latency and VRAM *are* directly comparable (same machine, same
  fixture, same script): Q8_0 is both faster (71 ms vs F16's 193 ms, close
  to fp32's 180 ms) and smaller (1.2 GB vs F16's 2.35 GB) than fp32's 1.6 GB,
  with no measured accuracy cost on this fixture. If a decision ever turns
  on this, Q8_0 is the more promising of the two quantisations measured, but
  one contract's 18 questions is too small a sample to change MAS-61's
  `portable`/`quality` split on its own.

See `CLAUDE.md`'s "Embedding Model Decision" and "GPU benchmark and profiles"
sections for the full narrative and the two deployment profiles
(`portable`/`quality`) this comparison informed.
