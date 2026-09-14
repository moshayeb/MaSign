# Architecture Notes

The service is organized around a contract review workflow:

1. `app/ingestion` loads contracts, extracts text, chunks clauses, and prepares metadata.
2. `app/retrieval` embeds chunks and retrieves relevant context for user questions.
3. `app/risk_analysis` evaluates retrieved clauses for legal, operational, and commercial risk.
4. `app/actions` turns analysis outputs into review tasks or downstream workflow actions.
5. `app/database` stores contracts, chunks, analyses, and review state.

The current implementation is a scaffold. The module boundaries are intentionally narrow so each stage can be replaced with production infrastructure without reshaping the API surface.
