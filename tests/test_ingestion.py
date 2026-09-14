from itertools import pairwise
from pathlib import Path

import pytest

from app.ingestion.parsing import (
    DocumentParseError,
    NoExtractableTextError,
    UnsupportedFileTypeError,
    extract_text,
)
from app.ingestion.pipeline import chunk_contract_text, load_contract_text


SAMPLE_CONTRACT = (
    Path(__file__).resolve().parent.parent
    / "data"
    / "sample_contracts"
    / "acme_vendor_agreement.txt"
)


# --- AA-22: extract raw text ------------------------------------------------


def test_extract_text_from_txt() -> None:
    content = b"1. Services\nVendor will provide services."

    assert extract_text(content, "txt") == "1. Services\nVendor will provide services."


def test_extract_text_strips_utf8_bom_and_crlf() -> None:
    content = "﻿ACME Vendor Agreement\r\n\r\n1. Services\r\n".encode("utf-8")

    assert extract_text(content, "txt") == "ACME Vendor Agreement\n\n1. Services"


def test_extract_text_from_pdf(make_pdf) -> None:
    pdf = make_pdf(["3. Limitation of Liability", "Vendor liability is capped."])

    text = extract_text(pdf, "pdf")

    assert "Limitation of Liability" in text
    assert "capped" in text


def test_extract_text_from_docx(make_docx) -> None:
    docx = make_docx(["4. Termination", "Either party may terminate for breach."])

    text = extract_text(docx, "docx")

    assert "4. Termination" in text
    assert "Either party may terminate for breach." in text


def test_extract_text_reads_docx_tables(make_docx) -> None:
    docx = make_docx(["2. Fees"], table_rows=[["Term", "36 months"]])

    text = extract_text(docx, "docx")

    assert "Term | 36 months" in text


def test_scanned_pdf_reports_no_extractable_text(make_scanned_pdf) -> None:
    with pytest.raises(NoExtractableTextError):
        extract_text(make_scanned_pdf(), "pdf")


def test_corrupted_pdf_reports_parse_error() -> None:
    with pytest.raises(DocumentParseError):
        extract_text(b"%PDF-1.4\nnot actually a pdf body", "pdf")


def test_corrupted_docx_reports_parse_error() -> None:
    with pytest.raises(DocumentParseError):
        extract_text(b"PK\x03\x04 not a real docx package", "docx")


def test_empty_text_file_reports_no_extractable_text() -> None:
    with pytest.raises(NoExtractableTextError):
        extract_text(b"   \n\n  ", "txt")


def test_unknown_file_type_is_rejected() -> None:
    with pytest.raises(UnsupportedFileTypeError):
        extract_text(b"anything", "rtf")


# --- AA-23: chunking --------------------------------------------------------


def test_chunking_keeps_short_contract_in_one_chunk() -> None:
    text = SAMPLE_CONTRACT.read_text(encoding="utf-8")

    chunks = chunk_contract_text(text)

    assert len(chunks) == 1
    assert "Limitation of Liability" in chunks[0]


def test_chunking_keeps_a_clause_heading_with_its_body() -> None:
    text = "1. Services\nVendor will provide services.\n\n2. Fees\nACME will pay."

    chunks = chunk_contract_text(text, max_chars=60, overlap_chars=0)

    assert chunks[0] == "1. Services\nVendor will provide services."
    assert chunks[1] == "2. Fees\nACME will pay."


def test_chunks_never_exceed_max_chars() -> None:
    text = "\n\n".join(f"{n}. Clause\n{'word ' * 60}".strip() for n in range(1, 12))

    chunks = chunk_contract_text(text, max_chars=400, overlap_chars=80)

    assert len(chunks) > 1
    assert all(len(chunk) <= 400 for chunk in chunks)


def test_consecutive_chunks_overlap() -> None:
    paragraphs = [f"{n}. Clause\n{'alpha beta gamma ' * 12}".strip() for n in range(1, 8)]

    chunks = chunk_contract_text("\n\n".join(paragraphs), max_chars=400, overlap_chars=100)

    assert len(chunks) > 1
    for previous, following in pairwise(chunks):
        carried = following.split("\n\n")[0]
        assert carried and carried in previous


def test_overlap_can_be_disabled() -> None:
    paragraphs = [f"{n}. Clause\n{'word ' * 40}".strip() for n in range(1, 6)]

    chunks = chunk_contract_text("\n\n".join(paragraphs), max_chars=300, overlap_chars=0)

    assert len(chunks) > 1
    assert sum(len(chunk) for chunk in chunks) < len("\n\n".join(paragraphs)) + len(chunks) * 4


def test_paragraph_longer_than_the_budget_is_split() -> None:
    text = "1. Services\n" + ("obligation " * 200).strip()

    chunks = chunk_contract_text(text, max_chars=300, overlap_chars=50)

    assert len(chunks) > 1
    assert all(len(chunk) <= 300 for chunk in chunks)
    assert "obligation" in chunks[-1]


def test_unbroken_run_of_characters_is_still_split() -> None:
    chunks = chunk_contract_text("x" * 500, max_chars=100, overlap_chars=0)

    assert len(chunks) == 5
    assert all(len(chunk) <= 100 for chunk in chunks)


def test_blank_text_produces_no_chunks() -> None:
    assert chunk_contract_text("   \n\n  ") == []


def test_invalid_chunk_settings_are_rejected() -> None:
    with pytest.raises(ValueError):
        chunk_contract_text("text", max_chars=0)

    with pytest.raises(ValueError):
        chunk_contract_text("text", max_chars=100, overlap_chars=100)


# --- end to end -------------------------------------------------------------


def test_sample_contract_loads_and_chunks() -> None:
    text = load_contract_text(SAMPLE_CONTRACT)

    chunks = chunk_contract_text(text, max_chars=120, overlap_chars=20)

    assert len(chunks) > 1
    assert all(chunk.strip() for chunk in chunks)

    # Splitting happens on word boundaries, so every word of the contract
    # survives somewhere even when a clause is broken across chunks.
    joined = " ".join(chunks)
    for word in text.split():
        assert word in joined
