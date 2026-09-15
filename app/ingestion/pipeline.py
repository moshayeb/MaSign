"""Turning contract documents into chunks ready for embedding."""

import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.ingestion.parsing import extract_text, normalize_text


DEFAULT_MAX_CHARS = 1200
DEFAULT_OVERLAP_CHARS = 150

# Placed between the carried-over overlap and the chunk's own text.
OVERLAP_SEPARATOR = "\n\n"


@dataclass(frozen=True)
class TokenBudget:
    """A second size limit, in the embedding model's own tokens (MAS-49).

    Characters are a poor proxy for tokens: number-heavy financial text packs
    ~0.45 tokens per character, so a chunk within `max_chars` can still exceed
    the model's sequence limit and be silently cut short. `count` must measure
    a text the way the model will see it (any prefix and special tokens
    included), so `max_tokens` can simply be the model's limit.
    """

    count: Callable[[str], int]
    max_tokens: int


def load_contract_text(path: Path) -> str:
    """Read a contract from disk, choosing the parser from its extension."""
    file_type = path.suffix.lower().lstrip(".")
    return extract_text(path.read_bytes(), file_type)


def chunk_contract_text(
    text: str,
    max_chars: int = DEFAULT_MAX_CHARS,
    overlap_chars: int = DEFAULT_OVERLAP_CHARS,
    *,
    token_budget: TokenBudget | None = None,
) -> list[str]:
    """Split contract text into overlapping chunks sized for embedding.

    Chunks follow the document's own paragraph breaks so a clause keeps its
    heading, and each chunk after the first repeats the tail of the one before
    it, so a clause split across a boundary still has its lead-in for context.
    No chunk exceeds `max_chars`, nor `token_budget.max_tokens` when given —
    the token limit is checked on the finished chunk, overlap included.
    """
    if max_chars <= 0:
        raise ValueError("max_chars must be positive.")
    if overlap_chars < 0:
        raise ValueError("overlap_chars cannot be negative.")
    if overlap_chars >= max_chars:
        raise ValueError("overlap_chars must be smaller than max_chars.")

    # Pack into the budget left once the overlap prefix and its separator are
    # added back, so the finished chunks still fit inside max_chars.
    budget = max_chars - (overlap_chars + len(OVERLAP_SEPARATOR) if overlap_chars else 0)
    if budget <= 0:
        raise ValueError(
            f"max_chars must leave room for overlap_chars plus the "
            f"{len(OVERLAP_SEPARATOR)}-character separator."
        )

    if token_budget is not None and token_budget.count("a") > token_budget.max_tokens:
        raise ValueError(
            f"The token budget of {token_budget.max_tokens} cannot hold even a one-character "
            f"chunk once the model's own prefix and special tokens are counted."
        )

    text = normalize_text(text)
    if not text:
        return []

    def within_tokens(chunk: str) -> bool:
        return token_budget is None or token_budget.count(chunk) <= token_budget.max_tokens

    def carried_from(previous: str | None) -> str:
        if not previous or not overlap_chars:
            return ""
        carried = _trailing_context(previous, overlap_chars)
        if token_budget is None:
            return carried
        # The overlap may take at most half the token budget, so the chunk's
        # own text always gets the other half; with a small limit it shrinks,
        # and if even a sliver won't fit it is dropped (MAS-57).
        chars = overlap_chars
        while carried and token_budget.count(f"{carried}{OVERLAP_SEPARATOR}") > token_budget.max_tokens // 2:
            chars //= 2
            carried = _trailing_context(previous, chars) if chars else ""
        return carried

    def assemble(body: str, previous: str | None) -> str:
        carried = carried_from(previous)
        return f"{carried}{OVERLAP_SEPARATOR}{body}" if carried else body

    def fits(body: str, previous: str | None) -> bool:
        return len(body) <= budget and within_tokens(assemble(body, previous))

    bodies = _pack_paragraphs(_split_paragraphs(text), fits)
    chunks = [assemble(body, bodies[index - 1] if index else None) for index, body in enumerate(bodies)]
    for chunk in chunks:
        if len(chunk) > max_chars or not within_tokens(chunk):
            raise AssertionError(f"chunker produced an oversized chunk ({len(chunk)} chars): {chunk[:60]!r}…")
    return chunks


def _split_paragraphs(text: str) -> list[str]:
    """Split on blank lines, keeping a clause heading with its body."""
    blocks = re.split(r"\n\s*\n", text)
    return [block.strip() for block in blocks if block.strip()]


# Whether a chunk body fits, given the body that will precede it (its overlap
# is part of the finished chunk, so it counts towards the size).
Fits = Callable[[str, str | None], bool]


def _pack_paragraphs(paragraphs: list[str], fits: Fits) -> list[str]:
    packed: list[str] = []
    current = ""

    def previous() -> str | None:
        return packed[-1] if packed else None

    for paragraph in paragraphs:
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if fits(candidate, previous()):
            current = candidate
            continue

        if current:
            packed.append(current)
            current = ""

        if fits(paragraph, previous()):
            current = paragraph
        else:
            # A single clause longer than the budget cannot be packed; split
            # it on word boundaries.
            packed.extend(_split_oversized(paragraph, fits, previous()))

    if current:
        packed.append(current)

    return packed


def _split_oversized(paragraph: str, fits: Fits, previous: str | None) -> list[str]:
    """Break one over-long paragraph into pieces, preferring word boundaries."""
    pieces: list[str] = []
    remaining = paragraph

    while remaining and not fits(remaining, previous):
        cut = _longest_fitting_prefix(remaining, lambda prefix: fits(prefix, previous))
        pieces.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
        previous = pieces[-1]

    if remaining:
        pieces.append(remaining)

    return pieces


def _longest_fitting_prefix(text: str, fits: Callable[[str], bool]) -> int:
    """Length of the longest fitting prefix, cut at whitespace when any such cut fits."""
    boundaries = [match.start() for match in re.finditer(r"\s", text) if match.start() > 0]
    cut = _last_fitting(boundaries, lambda position: fits(text[:position]))
    if cut is None:
        # Not even the first word fits: a single unbroken run of characters.
        cut = _last_fitting(range(1, len(text)), lambda position: fits(text[:position])) or 1
    return cut


def _last_fitting(positions, fits_at: Callable[[int], bool]) -> int | None:
    """Largest position that fits. Fitting is monotone: true up to some point, then false."""
    low, high = 0, len(positions)
    while low < high:
        middle = (low + high) // 2
        if fits_at(positions[middle]):
            low = middle + 1
        else:
            high = middle
    return positions[low - 1] if low else None


def _trailing_context(text: str, overlap_chars: int) -> str:
    """Return the last `overlap_chars` of text, without a clipped first word."""
    if len(text) <= overlap_chars:
        return text

    tail = text[-overlap_chars:]
    # Drop the leading fragment so the overlap starts on a whole word.
    trimmed = re.sub(r"^\S*\s+", "", tail, count=1)
    return trimmed.strip() or tail.strip()
