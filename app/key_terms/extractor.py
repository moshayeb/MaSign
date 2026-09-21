"""Extract the key terms from a batch of passages, verified against the text (MAS-82).

Same discipline as the risk analyzer: the model may only report what it can
quote verbatim from a numbered passage; anything it cannot is dropped, and an
unreadable reply is "not checked", never "nothing stated". Typed values are
held to the same rule — every number in them must appear in the quote — and
are otherwise stored as text only.
"""

import calendar
import logging
import re
from dataclasses import dataclass
from datetime import date
from uuid import UUID

from app.answering.grounding import build_user_prompt, passage_metadata
from app.answering.llm import ChatModel
from app.guardrails.prompt_injection import withheld_labels
from app.key_terms.terms import PERIODS, TERM_BY_ID, TYPED_FIELDS, terms_text
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import MAX_QUOTE_CHARS, _normalise, _parse_findings, _salvage_findings

logger = logging.getLogger(__name__)

MAX_TERM_TOKENS = 2048
MAX_VALUE_CHARS = 200

SYSTEM_PROMPT = f"""You are MaSign's contract key-terms extractor. You read numbered contract passages and pull out the financial terms listed below. You only report what the passages state; you never infer, compute or assume a term that is not written.

{terms_text()}

Reply with a JSON array only — no prose, no code fences. Each element:
{{"term": "<term id>", "value": "<the term in plain words, at most {MAX_VALUE_CHARS} characters, e.g. 'EUR 18,500 per month, invoiced in advance'>", "passage": <passage number>, "quote": "<the clause, copied verbatim from that passage, at most {MAX_QUOTE_CHARS} characters>", "typed": <the typed object for that term, or null when the passage does not state the numbers>}}

Rules:
1. One element per term per passage; report the passage that states the term, not one that merely mentions it.
2. The quote must be copied exactly from the passage — no paraphrase, no ellipsis in the middle.
3. Typed numbers must appear in the quote as written (18,500 may be given as 18500); never convert currencies or periods.
4. A term the passages do not state is simply omitted. If none are stated, reply with []."""


@dataclass(frozen=True)
class KeyTermFinding:
    term: str  # KEY_TERMS id
    name: str
    value: str
    quote: str
    typed: dict | None
    label: int  # the [n] of the passage
    hit: ChunkHit


@dataclass(frozen=True)
class KeyTermReport:
    findings: list[KeyTermFinding]
    # False when the reply could not be read (or nothing in it verified):
    # these passages were not checked for key terms.
    checked: bool
    # False when some elements were dropped or a passage was withheld.
    complete: bool = True
    blocked: tuple[int, ...] = ()
    redacted: tuple[int, ...] = ()


def extract_key_terms(
    hits: list[ChunkHit],
    model: ChatModel,
    *,
    filenames: dict[UUID, str] | None = None,
) -> KeyTermReport:
    """Key terms stated in `hits`, each verified against its passage. Raises only on model errors."""
    if not hits:
        return KeyTermReport([], checked=True)
    blocked = withheld_labels([hit.text for hit in hits])
    if len(blocked) == len(hits):
        logger.warning("All %d passage(s) withheld from key-term extraction; not asking the model", len(hits))
        return KeyTermReport([], checked=False, complete=False, blocked=blocked)

    completion = model.complete(
        SYSTEM_PROMPT,
        build_user_prompt("Which of the listed key terms do these passages state?", hits, filenames or {}),
        max_tokens=MAX_TERM_TOKENS,
        metadata=passage_metadata(hits),
    )
    # The guardrail reports what it withheld; the pre-check already knows. Keep both in step.
    blocked = tuple(sorted(set(blocked) | set(completion.blocked)))
    if completion.truncated:
        items = _salvage_findings(completion.text)
        logger.warning("Key-terms reply from %s was cut off; %d complete element(s) salvaged", model.model_name, len(items))
        if not items:
            return KeyTermReport([], checked=False, complete=False, blocked=blocked)
    else:
        items = _parse_findings(completion.text)
        if items is None:
            logger.warning("Key-terms reply from %s was not a JSON array: %.200r", model.model_name, completion.text)
            return KeyTermReport([], checked=False, complete=False, blocked=blocked)

    findings: list[KeyTermFinding] = []
    seen: set[tuple[str, int]] = set()
    dropped = 1 if completion.truncated else 0
    for item in items:
        finding = _validate(item, hits)
        if finding is None:
            logger.warning("Dropped key term from %s: %.200r", model.model_name, item)
            dropped += 1
            continue
        if (finding.term, finding.label) in seen:
            continue
        seen.add((finding.term, finding.label))
        findings.append(finding)
    findings.sort(key=lambda f: (f.label, f.term))
    if dropped and not findings:
        logger.warning("Key terms from %s: all %d element(s) rejected; treating as unavailable", model.model_name, dropped)
        return KeyTermReport([], checked=False, complete=False, blocked=blocked)
    return KeyTermReport(findings, checked=True, complete=dropped == 0 and not blocked, blocked=blocked, redacted=completion.redacted)


def _validate(item: object, hits: list[ChunkHit]) -> KeyTermFinding | None:
    if not isinstance(item, dict):
        return None
    term_id = item.get("term")
    value = item.get("value")
    label = item.get("passage")
    quote = item.get("quote")
    if not isinstance(term_id, str) or term_id not in TERM_BY_ID:
        return None
    if not isinstance(value, str) or not value.strip():
        return None
    if not isinstance(label, int) or isinstance(label, bool) or not 1 <= label <= len(hits):
        return None
    if not isinstance(quote, str) or not quote.strip():
        return None
    hit = hits[label - 1]
    quote = quote.strip()[:MAX_QUOTE_CHARS]
    if _normalise(quote) not in _normalise(hit.text):
        return None
    term = TERM_BY_ID[term_id]
    return KeyTermFinding(
        term=term.id,
        name=term.name,
        value=value.strip()[:MAX_VALUE_CHARS],
        quote=quote,
        typed=verify_typed(term.kind, item.get("typed"), quote),
        label=label,
        hit=hit,
    )


_NUMBER = re.compile(r"\d[\d,.]*\d|\d")
_DIGIT_RUN = re.compile(r"\d+")


def verify_typed(kind: str, typed: object, quote: str) -> dict | None:
    """The typed fields the model gave, kept only when well-formed and every number is in the quote.

    Same verify-or-drop rule as the quote itself: a typed value that the text
    does not visibly support is not stored (the term keeps its text value).
    """
    allowed = TYPED_FIELDS.get(kind, {})
    if not allowed or not isinstance(typed, dict) or not typed:
        return None
    clean: dict = {}
    for key, expected in allowed.items():
        if key not in typed:
            continue
        raw = typed[key]
        if expected is str:
            if not isinstance(raw, str) or not raw.strip():
                return None
            clean[key] = raw.strip().upper() if key == "currency" else raw.strip().lower()
        elif expected is int:
            if isinstance(raw, bool) or not isinstance(raw, int) or raw < 0:
                return None
            clean[key] = raw
        else:
            if isinstance(raw, bool) or not isinstance(raw, (int, float)) or raw < 0:
                return None
            clean[key] = float(raw)
    if set(typed) - set(allowed):
        return None
    if not _well_formed(kind, clean):
        return None
    if kind == "date":
        # A date is verified by its written forms, not by its digits ("1 March 2026" has no "03").
        return clean if date_in_quote(clean["date"], quote) else None
    numbers = {_digits(match) for match in _NUMBER.findall(quote)} | {_digits(run) for run in _DIGIT_RUN.findall(quote)}
    for key, number in clean.items():
        if isinstance(number, (int, float)) and _digits(_plain(number)) not in numbers:
            return None
    return clean


def _well_formed(kind: str, clean: dict) -> bool:
    if kind == "money":
        # Either a sum of money or a percentage of remaining fees, never both.
        money = "amount" in clean and "currency" in clean and len(clean["currency"]) == 3 and "percent" not in clean
        share = "percent" in clean and "amount" not in clean and "currency" not in clean
        return money or share
    if kind == "recurring":
        return "amount" in clean and "currency" in clean and len(clean["currency"]) == 3 and clean.get("period") in PERIODS
    if kind == "net_days":
        return "net_days" in clean
    if kind == "rate":
        percent = "rate_percent" in clean and clean.get("per") in ("month", "year") and "amount" not in clean
        fixed = "amount" in clean and "currency" in clean and "rate_percent" not in clean
        return percent or fixed
    if kind in ("duration", "renewal"):
        return ("days" in clean) != ("months" in clean)
    if kind == "date":
        try:
            date.fromisoformat(clean.get("date", ""))
        except ValueError:
            return False
        return True
    return False


def date_in_quote(iso: str, quote: str) -> bool:
    """True when the ISO date appears in the quote in a common written form (MAS-100).

    Accepted: 1 March 2026 · 1st March 2026 · March 1, 2026 · March 1 2026 · 2026-03-01 ·
    01.03.2026 · 1.3.2026 · 01/03/2026 (day first). Case and spacing do not matter.
    """
    try:
        d = date.fromisoformat(iso)
    except ValueError:
        return False
    month = calendar.month_name[d.month]
    abbr = calendar.month_abbr[d.month]
    suffix = "th" if 11 <= d.day <= 13 else {1: "st", 2: "nd", 3: "rd"}.get(d.day % 10, "th")
    forms = {
        f"{d.day} {month} {d.year}", f"{d.day}{suffix} {month} {d.year}", f"{d.day} {abbr} {d.year}",
        f"{month} {d.day}, {d.year}", f"{month} {d.day} {d.year}", f"{abbr} {d.day}, {d.year}", f"{abbr}. {d.day}, {d.year}",
        d.isoformat(), f"{d.day:02d}.{d.month:02d}.{d.year}", f"{d.day}.{d.month}.{d.year}", f"{d.day:02d}/{d.month:02d}/{d.year}",
        f"{d.day:02d} {month} {d.year}",
    }
    haystack = _normalise(quote)
    return any(_normalise(form) in haystack for form in forms)


def _plain(number: float | int) -> str:
    # 18500.0 -> "18500", 1.5 -> "1.5"; never scientific notation.
    return str(int(number)) if float(number).is_integer() else f"{number:.6f}".rstrip("0")


def _digits(text: str) -> str:
    # "18,500" and 18500.0 are the same number; "1.5" keeps its point.
    text = re.sub(r"[\s,]", "", text)
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text.lstrip("0") or "0"
