"""References to documents that are not part of the upload (MAS-84).

"Fees as set out in the Order Form", "the SLA in Schedule 2": a review can
only read what was uploaded, so a term that lives in another document is
"depends on a document not uploaded" — an unable-to-determine state, not a
"not stated". Detection is textual and deliberately narrow: a named
schedule / exhibit / annex / appendix / order form / SOW / addendum that is
referred to but never appears as a heading in the text itself.
"""

import re
from dataclasses import dataclass

# "Schedule 2", "Exhibit A", "Annex 1", "Appendix B", "Attachment 3", plus the
# common unnumbered ones. A word boundary keeps "scheduled" out.
# The keyword is case-insensitive (headings are often upper-case) but the
# letter is not: "schedule a meeting" is not Schedule A.
_NAMED = re.compile(
    r"\b((?i:Schedule|Exhibit|Annex|Appendix|Attachment|Addendum))\s+([A-Z]|[0-9]{1,2})\b(?![\w-])"
)
_UNNAMED = re.compile(r"\b(Order Form|Statement of Work|SOW|Service Level Agreement|SLA|Purchase Order)\b")
# A heading is the name at the start of a line, on its own or followed by a
# separator — that means the document is included in the upload.
_HEADING = re.compile(r"(?m)^\s*((?i:Schedule|Exhibit|Annex|Appendix|Attachment|Addendum))\s+([A-Z]|[0-9]{1,2})\s*(?:[-–—:.]|$)")
_UNNAMED_HEADING = re.compile(r"(?mi)^\s*(Order Form|Statement of Work|Service Level Agreement|Purchase Order)\s*(?:[-–—:.]|$)")


@dataclass(frozen=True)
class ExternalReference:
    name: str
    chunk_indexes: tuple[int, ...]


def find_external_references(chunk_texts: list[str]) -> list[ExternalReference]:
    """Documents the text refers to but does not contain, with the passages that mention them."""
    mentions: dict[str, list[int]] = {}
    present: set[str] = set()
    for index, text in enumerate(chunk_texts):
        for match in _HEADING.finditer(text):
            present.add(f"{match.group(1).title()} {match.group(2)}")
        for match in _UNNAMED_HEADING.finditer(text):
            present.add(_canonical(match.group(1)))
        for match in _NAMED.finditer(text):
            name = f"{match.group(1).title()} {match.group(2)}"
            mentions.setdefault(name, [])
            if index not in mentions[name]:
                mentions[name].append(index)
        for match in _UNNAMED.finditer(text):
            name = _canonical(match.group(1))
            mentions.setdefault(name, [])
            if index not in mentions[name]:
                mentions[name].append(index)
    return [ExternalReference(name, tuple(indexes)) for name, indexes in mentions.items() if name not in present]


def _canonical(name: str) -> str:
    return {"SOW": "Statement of Work", "SLA": "Service Level Agreement"}.get(name, name)
