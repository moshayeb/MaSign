"""Export a contract's review as Markdown or CSV (MAS-97).

Both renderings are built from the same response models the UI reads
(`RiskReviewResponse`, `KeyTermsResponse`), so a file can never say
something the screen does not. No model call is involved.
"""

from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.api.routes import KeyTermsResponse, RiskReviewResponse

NOT_ADVICE = "Graded from the Customer's side with MaSign's rubric (docs/risk-rubric.md); a first read, not legal advice."


def safe_filename(filename: str, extension: str) -> str:
    stem = re.sub(r"[^A-Za-z0-9._-]+", "-", filename.rsplit(".", 1)[0]).strip("-") or "contract"
    return f"{stem}-review.{extension}"


def render_markdown(filename: str, review: RiskReviewResponse, terms: KeyTermsResponse) -> str:
    lines = [f"# Review of {filename}", ""]
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
            lines.append("- Not graded (unreadable model reply): passage(s) " + ", ".join(str(i + 1) for i in review.coverage.unreadable_passages))
        if review.coverage.withheld_passages:
            lines.append("- Withheld from the model: passage(s) " + ", ".join(str(i + 1) for i in review.coverage.withheld_passages))
        for ref in review.coverage.external_references:
            lines.append(f"- Depends on a document not uploaded: {ref.name} (passage(s) {', '.join(str(i + 1) for i in ref.chunk_indexes)})")

    if terms.deadlines:
        lines += ["", "## Deadlines", ""]
        for d in terms.deadlines:
            if d.date:
                lines.append(f"- {d.name}: **{d.date.strftime('%d %b %Y')}** ({d.how}; from {', '.join(d.computed_from)})")
            else:
                lines.append(f"- {d.name}: cannot compute — {d.reason}")
    lines += ["", "## Key terms", ""]
    if not terms.complete:
        lines += ["Some passages could not be checked for key terms; a term marked *Not checked* may still be in the contract.", ""]
    lines += ["| Term | Value | Standard | Passage | Quote |", "|---|---|---|---|---|"]
    for term in terms.terms:
        std = _standard_cell(term)
        if term.source:
            lines.append(f"| {term.name} | {_cell(term.value)} | {std} | {term.source.chunk_index + 1} | {_cell(term.source.quote)} |")
            for other in term.others:
                lines.append(f"| {term.name} (also) | {_cell(other.value)} | | {other.chunk_index + 1} | {_cell(other.quote)} |")
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
            lines += [f"- **{f.category_name}** (passage {f.chunk_index + 1}): {f.reason}", f"  > {f.quote}", ""]
    lines += ["| Category | Worst severity |", "|---|---|"]
    for c in review.categories:
        verdict = c.worst_severity or ("Nothing found" if review.complete and review.status == "done" else "Unable to determine")
        lines.append(f"| {c.name} | {verdict} |")

    lines += ["", f"_{NOT_ADVICE}_", ""]
    return "\n".join(lines)


def render_csv(review: RiskReviewResponse, terms: KeyTermsResponse) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(["kind", "name", "severity_or_status", "value_or_reason", "standard", "passage", "quote"])
    for f in review.findings:
        writer.writerow(["finding", f.category_name, f.severity, f.reason, "", f.chunk_index + 1, f.quote])
    for term in terms.terms:
        if term.source:
            writer.writerow(["key_term", term.name, term.status, term.value, _standard_cell(term), term.source.chunk_index + 1, term.source.quote])
            for other in term.others:
                writer.writerow(["key_term", term.name, "also_stated", other.value, "", other.chunk_index + 1, other.quote])
        else:
            writer.writerow(["key_term", term.name, term.status, term.value, "", "", ""])
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


def _when(value: datetime) -> str:
    return value.strftime("%Y-%m-%d %H:%M UTC")
