"""Turning contract documents into chunks ready for embedding."""

import re
from pathlib import Path

from app.ingestion.parsing import extract_text, normalize_text


DEFAULT_MAX_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 150


def load_contract_text(path: Path) -> str:
    """Read a contract from disk, choosing the parser from its extension."""
    file_type = path.suffix.lower().lstrip(".")
    return extract_text(path.read_bytes(), file_type)


def chunk_contract_text(
    text: str,
    max_chars: int = DEFAULT_MAX_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
) -> list[str]:
    """Split contract text into overlapping chunks sized for embedding.

    Chunks follow the document's own paragraph breaks so a clause keeps its
    heading, and each chunk after the first repeats the tail of the one before
    it, so a clause split across a boundary still has its lead-in for context.
    No chunk exceeds `max_chars`.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive.")
    if overlap_chars < 0:
        raise ValueError("overlap_chars cannot be negative.")
    if overlap_chars >= max_chars:
        raise ValueError("overlap_chars must be smaller than max_chars.")

    text = normalize_text(text)
    if not text:
        return []

    # Pack into the budget left once the overlap prefix is added back, so the
    # finished chunks still fit inside max_chars.
    budget = max_chars - overlap_chars
    bodies = _pack_paragraphs(_split_paragraphs(text), budget)

    chunks = []
    for index, body in enumerate(bodies):
        if index == 0 or not overlap_chars:
            chunks.append(body)
            continue

        carried = _trailing_context(bodies[index - 1], overlap_chars)
        chunks.append(f"{carried}\n\n{body}" if carried else body)

    return chunks


def _split_paragraphs(text: str) -> list[str]:
    """Split on blank lines, keeping a clause heading with its body."""
    blocks = re.split(r"\n\s*\n", text)
    return [block.strip() for block in blocks if block.strip()]


def _pack_paragraphs(paragraphs: list[str], budget: int) -> list[str]:
    packed: list[str] = []
    current = ""

    for paragraph in paragraphs:
        if len(paragraph) > budget:
            # A single clause longer than the budget cannot be packed; flush
            # what we have and split it on word boundaries.
            if current:
                packed.append(current)
                current = ""
            packed.extend(_split_oversized(paragraph, budget))
            continue

        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= budget:
            current = candidate
        else:
            packed.append(current)
            current = paragraph

    if current:
        packed.append(current)

    return packed


def _split_oversized(paragraph: str, budget: int) -> list[str]:
    """Break one over-long paragraph into pieces, preferring word boundaries."""
    pieces = []
    remaining = paragraph

    while len(remaining) > budget:
        window = remaining[:budget]
        cut = window.rfind(" ")
        if cut <= 0:
            cut = budget  # a single unbroken run of characters
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()

    if remaining:
        pieces.append(remaining)

    return pieces


def _trailing_context(text: str, overlap_chars: int) -> str:
    """Return the last `overlap_chars` of text, without a clipped first word."""
    if len(text) <= overlap_chars:
        return text

    tail = text[-overlap_chars:]
    # Drop the leading fragment so the overlap starts on a whole word.
    trimmed = re.sub(r"^\S*\s+", "", tail, count=1)
    return trimmed.strip() or tail.strip()
