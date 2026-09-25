"""MAS-131: CSV export must not let a crafted contract shape a cell that
spreadsheet software (Excel, Google Sheets, LibreOffice) reads as a formula.

Unit-level, not through the API: render_csv() is a pure function of the
same response models the live UI reads, so these build minimal instances
directly rather than running a full upload + review pipeline.
"""

import csv
import io
from datetime import datetime, timezone
from uuid import uuid4

from app.api.export import render_csv, render_markdown
from app.api.routes import (
    KeyTermSource,
    KeyTermsResponse,
    KeyTermValue,
    ReviewFinding,
    RiskReviewResponse,
    StandardVerdict,
    DeadlineOut,
    Coverage,
    CoveragePassageOut,
)

NOW = datetime.now(timezone.utc)
NONE_STANDARD = StandardVerdict(status="none")


def _review(findings: list[ReviewFinding]) -> RiskReviewResponse:
    return RiskReviewResponse(
        contract_id=uuid4(),
        status="done",
        model="fake-chat",
        chunks_total=1,
        chunks_checked=1,
        chunks_withheld=0,
        complete=True,
        error=None,
        updated_at=NOW,
        findings=findings,
        categories=[],
        key_terms_complete=True,
        key_terms=[],
    )


def _terms(values: list[KeyTermValue]) -> KeyTermsResponse:
    return KeyTermsResponse(
        contract_id=uuid4(),
        status="done",
        complete=True,
        chunks_total=1,
        chunks_checked=1,
        chunks_withheld=0,
        model="fake-chat",
        updated_at=NOW,
        terms=values,
    )


def _finding(reason: str, quote: str) -> ReviewFinding:
    return ReviewFinding(
        category="liability", category_name="Liability cap", severity="High", reason=reason, quote=quote,
        chunk_id=uuid4(), chunk_index=0, contract_id=uuid4(),
    )


def _term_with_source(value: str, quote: str, others: list[KeyTermSource] | None = None) -> KeyTermValue:
    source = KeyTermSource(value=value, quote=quote, chunk_id=uuid4(), chunk_index=0, contract_id=uuid4(), typed=None)
    return KeyTermValue(id="recurring_fee", name="Recurring fee", kind="text", status="found", value=value, source=source, others=others or [], standard=NONE_STANDARD)


def _rows(review: RiskReviewResponse, terms: KeyTermsResponse) -> list[dict]:
    return list(csv.DictReader(io.StringIO(render_csv(review, terms))))


def test_a_finding_reason_and_quote_starting_with_a_formula_trigger_are_escaped() -> None:
    review = _review([_finding(reason="=cmd|' /c calc'!A1", quote="+1; a payout clause")])
    rows = _rows(review, _terms([]))

    finding = rows[0]
    assert finding["value_or_reason"] == "'=cmd|' /c calc'!A1"
    assert finding["quote"] == "'+1; a payout clause"


def test_a_key_term_value_and_quote_starting_with_a_formula_trigger_are_escaped() -> None:
    terms = _terms([_term_with_source(value="-2+3", quote="@SUM(A1:A9)")])
    rows = _rows(_review([]), terms)

    row = rows[0]
    assert row["value_or_reason"] == "'-2+3"
    assert row["quote"] == "'@SUM(A1:A9)"


def test_an_others_quote_starting_with_a_formula_trigger_is_also_escaped() -> None:
    other = KeyTermSource(value="=1+1", quote="ordinary quote", chunk_id=uuid4(), chunk_index=1, contract_id=uuid4(), typed=None)
    terms = _terms([_term_with_source(value="EUR 100", quote="ordinary quote", others=[other])])
    rows = _rows(_review([]), terms)

    also_stated = next(r for r in rows if r["severity_or_status"] == "also_stated")
    assert also_stated["value_or_reason"] == "'=1+1"


def test_ordinary_values_are_left_unchanged() -> None:
    review = _review([_finding(reason="Liability is uncapped.", quote="shall be unlimited")])
    terms = _terms([_term_with_source(value="EUR 18,500 per month", quote="pay EUR 18,500 per month")])
    rows = _rows(review, terms)

    finding = next(r for r in rows if r["kind"] == "finding")
    assert (finding["value_or_reason"], finding["quote"]) == ("Liability is uncapped.", "shall be unlimited")
    term = next(r for r in rows if r["kind"] == "key_term")
    assert (term["value_or_reason"], term["quote"]) == ("EUR 18,500 per month", "pay EUR 18,500 per month")


def test_bundle_exports_name_the_source_document_for_findings_terms_and_deadlines() -> None:
    finding = _finding(reason="Liability is uncapped.", quote="shall be unlimited")
    term = _term_with_source(value="36 months", quote="initial term is 36 months")
    terms = _terms([term])
    terms.deadlines = [DeadlineOut(id="term_end", name="Initial term ends", date=None, computed_from=["recurring_fee"], reason="effective date not stated", how=None)]
    documents = {finding.contract_id: "main-agreement.pdf", term.source.contract_id: "statement-of-work.docx"}

    markdown = render_markdown("main-agreement.pdf", _review([finding]), terms, documents)
    csv_rows = list(csv.DictReader(io.StringIO(render_csv(_review([finding]), terms, documents))))

    assert "## Documents in this review" in markdown
    assert "main-agreement.pdf" in markdown and "statement-of-work.docx" in markdown
    assert "main-agreement.pdf, passage 1" in markdown
    assert "statement-of-work.docx, passage 1" in markdown
    assert next(row for row in csv_rows if row["kind"] == "finding")["source_document"] == "main-agreement.pdf"
    assert next(row for row in csv_rows if row["kind"] == "key_term")["source_document"] == "statement-of-work.docx"
    assert next(row for row in csv_rows if row["kind"] == "deadline")["source_document"] == "statement-of-work.docx"


def test_bundle_coverage_export_names_each_document() -> None:
    main_id, linked_id = uuid4(), uuid4()
    review = _review([])
    review.coverage = Coverage(
        chunks_total=2,
        chunks_checked=0,
        unreadable_passages=[
            CoveragePassageOut(contract_id=main_id, filename="main-agreement.pdf", chunk_index=0),
            CoveragePassageOut(contract_id=linked_id, filename="statement-of-work.docx", chunk_index=0),
        ],
        withheld_passages=[],
        redacted_passages=[],
        ingestion_notes=[],
        external_references=[],
    )

    markdown = render_markdown(
        "main-agreement.pdf", review, _terms([]), {main_id: "main-agreement.pdf", linked_id: "statement-of-work.docx"}
    )

    assert "main-agreement.pdf, passage 1" in markdown
    assert "statement-of-work.docx, passage 1" in markdown
