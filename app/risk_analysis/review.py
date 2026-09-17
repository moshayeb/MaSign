"""Whole-contract risk review (MAS-81).

Every uploaded contract is read against the rubric in full, not only the
passages a question happens to retrieve: the chunks are sent to the model in
batches, each batch graded by `analyze_risks` with the same validation (a
finding must quote its passage verbatim), and the verified findings are
stored per contract. Silence in the review means "read, nothing found" —
a batch the model could not grade makes the review incomplete, and a model
failure makes it failed, never quietly empty.
"""

import logging
from uuid import UUID

from app.answering.llm import ChatModel, ChatModelError
from app.database import repository
from app.database.models import RiskReview
from app.database.session import get_connection
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import analyze_risks

logger = logging.getLogger(__name__)

# Passages per model call: enough context for one call to see related
# clauses, small enough for the reply to fit the risk token budget.
BATCH_SIZE = 8


def review_contract(contract_id: UUID, model: ChatModel, *, batch_size: int = BATCH_SIZE) -> RiskReview:
    """Run the rubric over all of a contract's chunks and store the result.

    Opens its own connection: it runs as a background task after the upload
    response, when the request's connection is already closed.
    """
    with get_connection() as db:
        contract = repository.get_contract(db, contract_id)
        if contract is None:
            raise LookupError(f"Contract {contract_id} not found")
        chunks = repository.list_chunks(db, contract_id)
        repository.start_risk_review(db, contract_id, status="running")
        repository.update_risk_review(
            db, contract_id, status="running", model=model.model_name, chunks_total=len(chunks), chunks_checked=0
        )

        findings: list[tuple[UUID, str, str, str, str]] = []
        complete = True
        checked = 0
        for start in range(0, len(chunks), batch_size):
            batch = chunks[start : start + batch_size]
            hits = [
                ChunkHit(chunk_id=c.id, contract_id=c.contract_id, chunk_index=c.chunk_index, text=c.chunk_text, score=1.0)
                for c in batch
            ]
            try:
                report = analyze_risks(hits, model, filenames={contract_id: contract.filename})
            except ChatModelError as error:
                logger.warning("Risk review of %s failed at passage %d: %s", contract.filename, start + 1, error)
                repository.replace_risk_findings(db, contract_id, findings)
                return repository.update_risk_review(
                    db, contract_id, status="failed", chunks_checked=checked, complete=False, error=str(error)
                )
            if not report.checked:
                # The model's reply for this batch was unusable: these
                # passages are not reviewed, and the result must say so.
                complete = False
            else:
                complete = complete and report.complete
                checked += len(batch)
                findings.extend((f.hit.chunk_id, f.category, f.severity, f.reason, f.quote) for f in report.findings)
            repository.update_risk_review(db, contract_id, status="running", chunks_checked=checked)

        repository.replace_risk_findings(db, contract_id, findings)
        review = repository.update_risk_review(
            db, contract_id, status="done", chunks_checked=checked, complete=complete and checked == len(chunks)
        )
        logger.info(
            "Risk review of %s: %d finding(s) over %d/%d passages%s",
            contract.filename, len(findings), checked, len(chunks), "" if review.complete else " (incomplete)",
        )
        return review


def run_review_in_background(contract_id: UUID, model: ChatModel) -> None:
    """Background-task wrapper: a crash is logged and recorded, never raised into the server."""
    try:
        review_contract(contract_id, model)
    except Exception as error:  # noqa: BLE001 - the task has no caller to report to
        logger.exception("Risk review of contract %s crashed", contract_id)
        try:
            with get_connection() as db:
                repository.update_risk_review(db, contract_id, status="failed", error=f"Review crashed: {error}")
        except Exception:  # noqa: BLE001
            logger.exception("Could not record the failed review of contract %s", contract_id)
