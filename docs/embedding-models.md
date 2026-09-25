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
- No int8/fp16-quantised Qwen3-Embedding-0.6B has been measured. If that
  comparison is wanted later, it reuses the existing `llama-server`/GGUF path
  already built for the 4B model — no new infrastructure, just a smaller
  file and a benchmark run.

See `CLAUDE.md`'s "Embedding Model Decision" and "GPU benchmark and profiles"
sections for the full narrative and the two deployment profiles
(`portable`/`quality`) this comparison informed.
