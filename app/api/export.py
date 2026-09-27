"""Export a contract's review as PDF, Markdown or CSV (MAS-154).

All renderings are built from the same response models the UI reads
(`RiskReviewResponse`, `KeyTermsResponse`), so a file can never say
something the screen does not. No model call is involved.
"""

from __future__ import annotations

import csv
import io
import re
from html import escape
from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer

if TYPE_CHECKING:
    from app.api.routes import KeyTermsResponse, RiskReviewResponse

NOT_ADVICE = "Graded from the Customer's side with MaSign's rubric (docs/risk-rubric.md); a first read, not legal advice."


def safe_filename(filename: str, extension: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", filename.rsplit(".", 1)[0]).strip("-") or "contract"
    return f"{stem}-review.{extension}"


def render_markdown(
    filename: str, review: RiskReviewResponse, terms: KeyTermsResponse, documents: dict[UUID, str] | None = None
) -> str:
    documents = documents or {review.contract_id: filename}
    lines = [f"# Review of {filename}", ""]
    lines += ["## Documents in this review", ""]
    lines.extend(f"- {name}" for name in dict.fromkeys(documents.values()))
    lines.append("")
    lines.append(f"- Reviewed: {_when(review.updated_at)}{f' by {review.model}' if review.model else ''}")
    lines.append(f"- Status: {review.status}{'' if review.complete else ' (incomplete)'} · {review.chunks_checked} of {review.chunks_total} passages graded"
                 + (f", {review.chunks_withheld} withheld" if review.chunks_withheld else ""))
    if review.coverage and review.coverage.document_kind and review.coverage.document_kind != "contract":
        what = "uncertain whether this is a commercial contract" if review.coverage.document_kind == "uncertain" else "likely not a commercial contract"
        looks = f" — looks like {review.coverage.document_looks_like}" if review.coverage.document_looks_like else ""
        lines.append(f"- Document type: {what}{looks}; the key terms and risk verdicts below use the contract rubric and may not be meaningful"
                     + (f" ({'; '.join(review.coverage.document_kind_reasons)})" if review.coverage.document_kind_reasons else ""))
    if review.coverage:
        for note in review.coverage.ingestion_notes:
            lines.append(f"- Not reviewed: {note}")
        if review.coverage.unreadable_passages:
            lines.append("- Not graded (unreadable model reply): " + _passages(review.coverage.unreadable_passages, documents))
        if review.coverage.withheld_passages:
            lines.append("- Withheld from the model: " + _passages(review.coverage.withheld_passages, documents))
        for ref in review.coverage.external_references:
            lines.append(f"- Depends on a document not uploaded: {ref.name} ({_passages(ref.passages, documents)})")
        for ref in review.coverage.resolved_references:
            lines.append(f"- {ref.reference_name} — linked: {ref.linked_contract_filename}")

    if terms.deadlines:
        lines += ["", "## Deadlines", ""]
        for d in terms.deadlines:
            if d.date:
                lines.append(f"- {d.name}: **{d.date.strftime('%d %b %Y')}** ({d.how}; from {_deadline_sources(d, terms, documents)})")
            else:
                lines.append(f"- {d.name}: cannot compute — {d.reason}")
    lines += ["", "## Key terms", ""]
    if not terms.complete:
        lines += ["Some passages could not be checked for key terms; a term marked *Not checked* may still be in the contract.", ""]
    lines += ["| Term | Value | Standard | Source | Quote |", "|---|---|---|---|---|"]
    for term in terms.terms:
        std = _standard_cell(term)
        if term.source:
            lines.append(f"| {term.name} | {_cell(term.value)} | {std} | {_source(term.source, documents)} | {_cell(term.source.quote)} |")
            for other in term.others:
                lines.append(f"| {term.name} (also) | {_cell(other.value)} | | {_source(other, documents)} | {_cell(other.quote)} |")
        else:
            lines.append(f"| {term.name} | *{term.value}* | {std} | | |")
    if terms.deviations:
        lines += ["", f"{terms.deviations} term{'s' if terms.deviations != 1 else ''} deviate{'s' if terms.deviations == 1 else ''} from the Customer's standard (app/key_terms/standards.py)."]

    lines += ["", "## Risk findings", ""]
    if not review.findings:
        lines.append("Nothing was flagged in the graded passages." if review.complete else "No finding could be verified in the graded passages; the review is incomplete.")
    for severity in ("High", "Medium", "Low"):
        group = [f for f in review.findings if f.severity == severity]
        if not group:
            continue
        lines += [f"### {severity}", ""]
        for f in group:
            lines += [f"- **{f.category_name}** ({_source(f, documents)}): {f.reason}", f"  > {f.quote}", ""]
    lines += ["| Category | Worst severity |", "|---|---|"]
    for c in review.categories:
        verdict = c.worst_severity or ("Nothing found" if review.complete and review.status == "done" else "Unable to determine")
        lines.append(f"| {c.name} | {verdict} |")

    lines += ["", f"_{NOT_ADVICE}_", ""]
    return "\n".join(lines)


def render_pdf(
    filename: str, review: RiskReviewResponse, terms: KeyTermsResponse, documents: dict[UUID, str] | None = None
) -> bytes:
    """Render the same no-cost review data as a readable, downloadable PDF."""
    source = render_markdown(filename, review, terms, documents)
    output = io.BytesIO()
    document = SimpleDocTemplate(output, pagesize=A4, rightMargin=18 * mm, leftMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm)
    styles = getSampleStyleSheet()
    title = ParagraphStyle("MaSignTitle", parent=styles["Title"], fontName="Helvetica-Bold", fontSize=18, leading=22, textColor=HexColor("#111111"), spaceAfter=10)
    heading = ParagraphStyle("MaSignHeading", parent=styles["Heading2"], fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=HexColor("#087eac"), spaceBefore=12, spaceAfter=5)
    body = ParagraphStyle("MaSignBody", parent=styles["BodyText"], fontName="Helvetica", fontSize=9, leading=13, textColor=HexColor("#333333"), spaceAfter=3)
    story = []
    for raw in source.splitlines():
        line = raw.strip()
        if not line:
            story.append(Spacer(1, 3))
        elif line.startswith("# "):
            story.append(Paragraph(escape(line[2:]), title))
        elif line.startswith("## ") or line.startswith("### "):
            story.append(Paragraph(escape(line.lstrip("# ")), heading))
        else:
            line = line.strip("|").replace("|", "  ?  ")
            if set(line.replace("?", "").replace(" ", "")) <= {"-"}:
                continue
            line = line.replace("**", "").replace("*", "").replace("`", "").replace("???", "?")
            story.append(Paragraph(escape(line), body))
    document.build(story)
    return output.getvalue()


_FORMULA_TRIGGER_CHARS = ("=", "+", "-", "@")


def _escape_formula(value: str) -> str:
    """A CSV cell beginning with =, +, - or @ is read as a formula by Excel,
    Google Sheets and LibreOffice when the file is opened -- and some of
    these cells carry verbatim contract text (a model's quote, a typed
    value), which is attacker-controlled: a crafted contract could shape a
    cell to start with one of these (MAS-131). CSV itself has no escape for
    this; a leading apostrophe is what makes spreadsheet software treat the
    cell as literal text instead."""
    return f"'{value}" if value.lstrip().startswith(_FORMULA_TRIGGER_CHARS) else value


def _safe_row(writer, values: list) -> None:
    writer.writerow([_escape_formula(v) if isinstance(v, str) else v for v in values])


def render_csv(review: RiskReviewResponse, terms: KeyTermsResponse, documents: dict[UUID, str] | None = None) -> str:
    documents = documents or {}
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["kind", "name", "severity_or_status", "value_or_reason", "standard", "source_document", "passage", "quote"])
    for f in review.findings:
        _safe_row(writer, ["finding", f.category_name, f.severity, f.reason, "", documents.get(f.contract_id, "Contract"), f.chunk_index + 1, f.quote])
    for term in terms.terms:
        if term.source:
            _safe_row(writer, ["key_term", term.name, term.status, term.value, _standard_cell(term), documents.get(term.source.contract_id, "Contract"), term.source.chunk_index + 1, term.source.quote])
            for other in term.others:
                _safe_row(writer, ["key_term", term.name, "also_stated", other.value, "", documents.get(other.contract_id, "Contract"), other.chunk_index + 1, other.quote])
        else:
            _safe_row(writer, ["key_term", term.name, term.status, term.value, "", "", "", ""])
    for deadline in terms.deadlines:
        _safe_row(writer, ["deadline", deadline.name, "stated" if deadline.date else "cannot_compute", deadline.date.isoformat() if deadline.date else deadline.reason or "", "", _deadline_document(deadline, terms, documents), "", deadline.how or ""])
    return out.getvalue()


def _standard_cell(term) -> str:
    std = term.standard
    if std.status == "none":
        return ""
    if std.status == "meets":
        return f"meets ({std.standard})"
    if std.status == "deviates":
        return f"deviates: {std.detail} (standard: {std.standard})"
    return f"cannot compare (standard: {std.standard})"


def _cell(text: str) -> str:
    return text.replace("|", "\\|").replace("\n", " ")


def _source(item, documents: dict[UUID, str]) -> str:
    return f"{documents.get(item.contract_id, 'Contract')}, passage {item.chunk_index + 1}"


def _deadline_sources(deadline, terms, documents: dict[UUID, str]) -> str:
    names = []
    for term_id in deadline.computed_from:
        term = next((item for item in terms.terms if item.id == term_id and item.source), None)
        if term and term.source:
            names.append(f"{term.name} ({documents.get(term.source.contract_id, 'Contract')})")
    return ", ".join(names) or ", ".join(deadline.computed_from)


def _deadline_document(deadline, terms, documents: dict[UUID, str]) -> str:
    for term_id in deadline.computed_from:
        term = next((item for item in terms.terms if item.id == term_id and item.source), None)
        if term and term.source:
            return documents.get(term.source.contract_id, "Contract")
    return ""


def _passages(passages, documents: dict[UUID, str]) -> str:
    """Name each physical source; bundle members restart at passage one."""
    return ", ".join(
        f"{documents.get(passage.contract_id, passage.filename)}, passage {passage.chunk_index + 1}"
        for passage in passages
    )


def _when(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M UTC")
