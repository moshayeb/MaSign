"""Invoice-specific PDF text extraction with page provenance (MAS-92).

Unlike contract ingestion (app/ingestion/parsing.py), page boundaries are kept
rather than flattened into one blob of text: an invoice is usually one or two
pages, and a citation needs to point at a page a reader can open, not an
opaque chunk index. Digital PDF only -- OCR and scanned images are explicitly
out of scope for this story: a PDF with no text layer on any page is rejected
outright, never silently turned into an empty or falsely "clean" result.
"""

from dataclasses import dataclass, field
from io import BytesIO

import pypdf

from app.ingestion.parsing import normalize_text


@dataclass(frozen=True)
class InvoicePage:
    page: int  # the real, 1-based PDF page number -- a dropped page leaves a gap
    text: str


@dataclass(frozen=True)
class ExtractedInvoice:
    pages: list[InvoicePage]
    notes: list[str] = field(default_factory=list)


class InvoiceTextError(ValueError):
    """Base class for failures to get text out of an uploaded invoice."""


class InvoiceParseError(InvoiceTextError):
    """Raised when the PDF cannot be opened or read at all."""


class NoExtractableInvoiceTextError(InvoiceTextError):
    """Raised when every page is unreadable -- most often a scanned invoice.

    OCR is out of scope for MAS-92: this never degrades into an empty or
    falsely "clean" result; the upload is rejected outright.
    """


def extract_invoice(content: bytes) -> ExtractedInvoice:
    """The page-by-page text of a validated PDF invoice.

    Raises `InvoiceParseError` if the bytes cannot be read, and
    `NoExtractableInvoiceTextError` if they can be read but no page has a text
    layer.
    """
    try:
        reader = pypdf.PdfReader(BytesIO(content))
        raw_pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as error:  # pypdf raises a wide range of parse errors
        raise InvoiceParseError(
            "The PDF could not be read. It may be corrupted or password protected."
        ) from error

    pages: list[InvoicePage] = []
    empty: list[int] = []
    for number, text in enumerate(raw_pages, start=1):
        cleaned = normalize_text(text)
        if cleaned:
            pages.append(InvoicePage(number, cleaned))
        else:
            empty.append(number)

    if not pages:
        raise NoExtractableInvoiceTextError(
            "No readable text found in the invoice. Scanned invoices must be "
            "run through OCR before they can be checked."
        )

    notes = []
    if empty:
        notes.append(
            f"{_page_list(empty)} of {len(raw_pages)} {'has' if len(empty) == 1 else 'have'} no text layer "
            "(scanned or image-only) and could not be read."
        )
    return ExtractedInvoice(pages, notes)


def _page_list(numbers: list[int]) -> str:
    if len(numbers) == 1:
        return f"Page {numbers[0]}"
    if len(numbers) <= 6:
        return "Pages " + ", ".join(str(n) for n in numbers[:-1]) + f" and {numbers[-1]}"
    return f"{len(numbers)} pages"
