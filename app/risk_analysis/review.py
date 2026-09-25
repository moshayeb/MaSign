"""Whole-contract risk review (MAS-81).

Every uploaded contract is read against the rubric in full, not only the
passages a question happens to retrieve: the chunks are sent to the model in
batches, each batch graded by `analyze_risks` with the same validation (a
finding must quote its passage verbatim), and the verified findings are
stored per contract. Silence in the review means "read, nothing found" —
a batch the model could not grade makes the review incomplete, a passage the
guardrail withheld counts as not graded (MAS-94), and a model failure makes
it failed, never quietly empty. Since MAS-82 the same job extracts the
contract's financial key terms, one more call per batch, with its own
completeness flag so an unreadable key-terms reply never reads as "not stated".
Since MAS-129 risk grading and key-term extraction are graded in separate
try/except blocks per batch: they are independent model calls, so a
key-terms-only failure marks key terms incomplete without discarding this
batch's (or any prior batch's) already-verified risk findings and without
marking the whole review "failed" — only a risk-grading failure does that.
Since MAS-138, when the contract has documents linked to it (MAS-137) the
review reads every bundle member's chunks as one unit, stored under the
primary contract — a linked document opened on its own still keeps its own
independent review.
"""

import logging
from uuid import UUID

from app.answering.llm import ChatModel, ChatModelError
from app.database import repository
from app.database.models import RiskReview
from app.database.session import get_connection
from app.key_terms.extractor import extract_key_terms
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import analyze_risks

logger = logging.getLogger(__name__)

# Passages per model call: enough context for one call to see related
# clauses, small enough for the reply to fit the risk token budget.
BATCH_SIZE = 8


def review_contract(contract_id: UUID, model: ChatModel, *, batch_size: int = BATCH_SIZE) -> RiskReview:
    """Run the rubric over all of a contract's chunks and store the result.

    When `contract_id` has documents linked to it (MAS-137), every bundle
    member's chunks are read as one review unit and stored under
    `contract_id` — the primary — while each finding and key term still
    points at its real chunk, so which document it came from is never lost
    (`ReviewFinding`/`KeyTermSource` resolve it from the chunk's own
    contract_id, app/api/routes.py). A linked document opened on its own
    keeps its own independent review.

    Opens its own connection: it runs as a background task after the upload
    response, when the request's connection is already closed.
    """
    with get_connection() as db:
        contract = repository.get_contract(db, contract_id)
        if contract is None:
            raise LookupError(f"Contract {contract_id} not found")
        bundle_ids = repository.bundle_contract_ids(db, contract_id)
        filenames = {cid: c.filename for cid in bundle_ids if (c := repository.get_contract(db, cid)) is not None}
        chunks = [chunk for cid in bundle_ids for chunk in repository.list_chunks(db, cid)]
        repository.start_risk_review(db, contract_id, status="running")
        repository.update_risk_review(
            db,
            contract_id,
            status="running",
            model=model.model_name,
            chunks_total=len(chunks),
            chunks_checked=0,
            chunks_withheld=0,
        )
        # Repository transaction blocks are savepoints once the reads above
        # have opened psycopg's implicit transaction. Commit explicitly so a
        # polling request can see that work started before the model calls.
        db.commit()

        findings: list[tuple[UUID, str, str, str, str]] = []
        terms: list[tuple[UUID, str, str, str, dict | None]] = []
        complete = True
        terms_complete = True
        checked = 0
        withheld = 0
        unreadable_chunks: list[int] = []
        withheld_chunks: list[int] = []
        redacted_chunks: list[int] = []
        for start in range(0, len(chunks), batch_size):
            batch = chunks[start : start + batch_size]
            hits = [
                ChunkHit(chunk_id=c.id, contract_id=c.contract_id, chunk_index=c.chunk_index, text=c.chunk_text, score=1.0)
                for c in batch
            ]
            try:
                report = analyze_risks(hits, model, filenames=filenames)
            except ChatModelError as error:
                logger.warning("Risk review of %s failed at passage %d: %s", contract.filename, start + 1, error)
                repository.replace_risk_findings(db, contract_id, findings)
                repository.replace_key_terms(db, contract_id, terms)
                return repository.update_risk_review(
                    db,
                    contract_id,
                    status="failed",
                    chunks_checked=checked,
                    chunks_withheld=withheld,
                    unreadable_chunks=unreadable_chunks,
                    withheld_chunks=withheld_chunks,
                    complete=False,
                    error=str(error),
                )
            # Passages the guardrail withheld were never graded: they are
            # neither checked nor clean, and the review says so (MAS-94).
            withheld += len(report.blocked)
            withheld_chunks.extend(batch[label - 1].chunk_index for label in report.blocked)
            redacted_chunks.extend(batch[label - 1].chunk_index for label in report.redacted)
            if not report.checked:
                # The model's reply for this batch was unusable: these
                # passages are not reviewed, and the result must say so —
                # by number, so the user can read them by hand (MAS-84).
                # Known gap for a bundle (MAS-138): these are bare chunk_index
                # ints, ambiguous if two bundle members both have that index —
                # Coverage's own disambiguation is MAS-139's job, not this one's.
                complete = False
                unreadable_chunks.extend(c.chunk_index for label, c in enumerate(batch, start=1) if label not in report.blocked)
            else:
                complete = complete and report.complete
                checked += len(batch) - len(report.blocked)
                findings.extend((f.hit.chunk_id, f.category, f.severity, f.reason, f.quote) for f in report.findings)

            # Key terms is a separate model call and a separate failure domain
            # from risk grading above (MAS-129): its own try/except means a
            # key-terms-only failure never discards this batch's — or any
            # prior batch's — already-verified risk findings, and never turns
            # the whole review "failed" over something that is not a risk
            # review failure. It only marks key terms incomplete, same as an
            # unusable reply already does below, so the card says "Not
            # checked" instead of silently reading "not stated" (MAS-82).
            try:
                term_report = extract_key_terms(hits, model, filenames=filenames)
            except ChatModelError as error:
                logger.warning("Key-term extraction of %s failed at passage %d: %s", contract.filename, start + 1, error)
                terms_complete = False
            else:
                terms_complete = terms_complete and term_report.checked and term_report.complete
                terms.extend((t.hit.chunk_id, t.term, t.value, t.quote, t.typed) for t in term_report.findings)
            repository.update_risk_review(
                db,
                contract_id,
                status="running",
                chunks_checked=checked,
                chunks_withheld=withheld,
                unreadable_chunks=unreadable_chunks,
                withheld_chunks=withheld_chunks,
                redacted_chunks=redacted_chunks,
            )
            # Publish progress after every completed batch. If the process is
            # interrupted later, startup can recover this visible running row.
            db.commit()

        repository.replace_risk_findings(db, contract_id, findings)
        repository.replace_key_terms(db, contract_id, terms)
        review = repository.update_risk_review(
            db,
            contract_id,
            status="done",
            chunks_checked=checked,
            chunks_withheld=withheld,
            unreadable_chunks=unreadable_chunks,
            withheld_chunks=withheld_chunks,
            redacted_chunks=redacted_chunks,
            complete=complete and checked == len(chunks),
            key_terms_complete=terms_complete and withheld == 0,
        )
        logger.info(
            "Risk review of %s%s: %d finding(s), %d key term(s) over %d/%d passages%s%s%s",
            contract.filename,
            f" (bundle of {len(bundle_ids)})" if len(bundle_ids) > 1 else "",
            len(findings),
            len(terms),
            checked,
            len(chunks),
            f", {withheld} withheld" if withheld else "",
            "" if review.complete else " (incomplete)",
            "" if review.key_terms_complete else " (key terms incomplete)",
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
