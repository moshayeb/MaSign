"""Text extraction for the supported contract file types.

Upload validation (AA-45) decides a file's type from its bytes and hands on a
``file_type`` of ``txt``, ``pdf`` or ``docx``. This module turns those bytes
into plain text. It deliberately imports nothing from the web layer, so the
same functions work from scripts, tests and the API.
"""

import re
from io import BytesIO
from zipfile import BadZipFile

import pypdf
from docx import Document
from docx.opc.exceptions import PackageNotFoundError
from docx.oxml.ns import qn
from docx.table import Table
from docx.text.paragraph import Paragraph
from lxml.etree import XMLSyntaxError


SUPPORTED_FILE_TYPES = ("txt", "pdf", "docx")


class DocumentTextError(ValueError):
    """Base class for failures to get text out of an uploaded document."""


class UnsupportedFileTypeError(DocumentTextError):
    """Raised for a file type the ingestion pipeline does not handle."""


class DocumentParseError(DocumentTextError):
    """Raised when a document cannot be opened or read at all."""


class NoExtractableTextError(DocumentTextError):
    """Raised when a document opens cleanly but holds no usable text.

    The case that matters in practice is a scanned contract: every page is an
    image, so the file is a structurally valid PDF and passes upload validation,
    but there is no text layer to read. Callers turn this into a clear
    unsupported-document message rather than an empty result.
    """


def extract_text(content: bytes, file_type: str) -> str:
    """Return the plain text of a validated upload.

    Raises `UnsupportedFileTypeError` for unknown types, `DocumentParseError`
    if the bytes cannot be read, and `NoExtractableTextError` if they can be
    read but contain no text.
    """
    if file_type == "txt":
        text = _extract_txt(content)
    elif file_type == "pdf":
        text = _extract_pdf(content)
    elif file_type == "docx":
        text = _extract_docx(content)
    else:
        raise UnsupportedFileTypeError(
            f"Cannot extract text from file type {file_type!r}. "
            f"Supported types are {', '.join(SUPPORTED_FILE_TYPES)}."
        )

    text = normalize_text(text)
    if not text:
        raise NoExtractableTextError(
            "No readable text found in the document. Scanned contracts must be "
            "run through OCR before they can be processed."
        )

    return text


def normalize_text(text: str) -> str:
    """Normalise line endings and whitespace without losing paragraph breaks."""
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = "\n".join(line.rstrip() for line in text.split("\n"))
    # Collapse runs of blank lines so paragraph splitting stays predictable.
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _extract_txt(content: bytes) -> str:
    # Validation already confirmed this decodes as UTF-8; utf-8-sig drops a BOM
    # if the file came from a Windows editor.
    return content.decode("utf-8-sig", errors="replace")


def _extract_pdf(content: bytes) -> str:
    try:
        reader = pypdf.PdfReader(BytesIO(content))
        pages = [page.extract_text() or "" for page in reader.pages]
    except Exception as error:  # pypdf raises a wide range of parse errors
        raise DocumentParseError(
            "The PDF could not be read. It may be corrupted or password protected."
        ) from error

    return "\n\n".join(page for page in pages if page.strip())


def _extract_docx(content: bytes) -> str:
    try:
        document = Document(BytesIO(content))
    except (PackageNotFoundError, BadZipFile, KeyError, ValueError, XMLSyntaxError) as error:
        # XMLSyntaxError: a ZIP shaped like a DOCX whose parts are not valid XML.
        raise DocumentParseError(
            "The DOCX file could not be read. It may be corrupted."
        ) from error

    # Walk the body in document order so a table stays between the paragraphs
    # that surround it; document.paragraphs / document.tables would separate
    # them and detach fees, dates or parties from their clause. Contract terms
    # are often laid out in tables, so their cells are included as one line per row.
    blocks = []
    for element in document.element.body.iterchildren():
        if element.tag == qn("w:p"):
            blocks.append(Paragraph(element, document).text)
        elif element.tag == qn("w:tbl"):
            for row in Table(element, document).rows:
                cells = [cell.text.strip() for cell in row.cells]
                line = " | ".join(cell for cell in cells if cell)
                if line:
                    blocks.append(line)

    return "\n".join(blocks)
