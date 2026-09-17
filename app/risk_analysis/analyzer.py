"""Flag risky clauses in retrieved passages (MAS-16).

One model call per query, over the same numbered passages the answer used.
The model returns JSON findings graded by the rubric; a finding survives only
if its category and severity are in the rubric, its passage number exists and
its quote appears verbatim in that passage — a risk flag with an invented
quote is worse than no flag. Findings are Customer-perspective (rubric.py).
"""

import json
import logging
import re
from dataclasses import dataclass
from uuid import UUID

from app.answering.grounding import build_user_prompt
from app.answering.llm import ChatModel
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.rubric import CATEGORY_BY_ID, SEVERITIES, rubric_text

logger = logging.getLogger(__name__)

MAX_RISK_TOKENS = 1024
MAX_QUOTE_CHARS = 400

SYSTEM_PROMPT = f"""You are MaSign's contract risk reviewer. You read numbered contract passages and flag clauses that carry risk according to the rubric below. You only report what the passages state; you never infer terms that are not written.

{rubric_text()}

Reply with a JSON array only — no prose, no code fences. Each element:
{{"category": "<category id>", "severity": "High" | "Medium" | "Low", "reason": "<one sentence, specific to the clause>", "passage": <passage number>, "quote": "<the clause, copied verbatim from that passage, at most {MAX_QUOTE_CHARS} characters>"}}

Rules:
1. At most one finding per category per passage; report the passage that states the clause, not one that merely mentions it.
2. The quote must be copied exactly from the passage — no paraphrase, no ellipsis in the middle.
3. Grade with the rubric; when a clause is standard and balanced, either omit it or report it as Low.
4. If nothing in the passages is a risk, reply with []."""


@dataclass(frozen=True)
class RiskFinding:
    category: str  # rubric id, e.g. "liability"
    category_name: str
    severity: str  # Low | Medium | High
    reason: str
    quote: str
    label: int  # the [n] of the passage, as in the answer's citations
    hit: ChunkHit


@dataclass(frozen=True)
class RiskReport:
    findings: list[RiskFinding]
    # False when the model's reply could not be read as findings — or every
    # finding in it failed validation: the UI says so instead of showing an
    # empty, reassuring list (MAS-74).
    checked: bool
    # False when some findings failed validation and were dropped: the ones
    # that passed are shown, with a warning that the analysis is incomplete.
    complete: bool = True


def analyze_risks(
    hits: list[ChunkHit],
    model: ChatModel,
    *,
    filenames: dict[UUID, str] | None = None,
) -> RiskReport:
    """Grade the retrieved passages with the rubric. Never raises on a bad reply, only on model errors."""
    if not hits:
        return RiskReport([], checked=True)

    completion = model.complete(
        SYSTEM_PROMPT,
        build_user_prompt("Which clauses in these passages are risky for the Customer?", hits, filenames or {}),
        max_tokens=MAX_RISK_TOKENS,
    )
    if completion.truncated:
        logger.warning("Risk analysis reply from %s was cut off; treating as unavailable", model.model_name)
        return RiskReport([], checked=False)

    items = _parse_findings(completion.text)
    if items is None:
        logger.warning("Risk analysis reply from %s was not a JSON array: %.200r", model.model_name, completion.text)
        return RiskReport([], checked=False)

    findings: list[RiskFinding] = []
    seen: set[tuple[str, int]] = set()
    dropped = 0
    for item in items:
        finding = _validate(item, hits)
        if finding is None:
            logger.warning("Dropped risk finding from %s: %.200r", model.model_name, item)
            dropped += 1
            continue
        if (finding.category, finding.label) in seen:
            continue
        seen.add((finding.category, finding.label))
        findings.append(finding)
    findings.sort(key=lambda f: (-SEVERITIES.index(f.severity), f.label))
    if dropped and not findings:
        # The model reported risks but none could be verified: that is an
        # unusable analysis, not a clean bill of health (MAS-74).
        logger.warning("Risk analysis from %s: all %d finding(s) rejected; treating as unavailable", model.model_name, dropped)
        return RiskReport([], checked=False)
    return RiskReport(findings, checked=True, complete=dropped == 0)


_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$")


def _parse_findings(text: str) -> list | None:
    try:
        data = json.loads(_FENCE.sub("", text.strip()))
    except ValueError:
        return None
    return data if isinstance(data, list) else None


def _validate(item: object, hits: list[ChunkHit]) -> RiskFinding | None:
    # Every field is type-checked before use: the model may answer with the
    # wrong shape (a list or object where a string belongs), and a finding
    # is dropped for that, never a request failed (MAS-75).
    if not isinstance(item, dict):
        return None
    category_id = item.get("category")
    severity = item.get("severity")
    reason = item.get("reason")
    label = item.get("passage")
    quote = item.get("quote")
    if not isinstance(category_id, str) or category_id not in CATEGORY_BY_ID:
        return None
    category = CATEGORY_BY_ID[category_id]
    if not isinstance(severity, str) or severity not in SEVERITIES:
        return None
    if not isinstance(reason, str) or not reason.strip():
        return None
    if not isinstance(label, int) or isinstance(label, bool) or not 1 <= label <= len(hits):
        return None
    if not isinstance(quote, str) or not quote.strip():
        return None
    hit = hits[label - 1]
    quote = quote.strip()[:MAX_QUOTE_CHARS]
    if _normalise(quote) not in _normalise(hit.text):
        return None
    return RiskFinding(
        category=category.id,
        category_name=category.name,
        severity=severity,
        reason=reason.strip(),
        quote=quote,
        label=label,
        hit=hit,
    )


def _normalise(text: str) -> str:
    # Whitespace and quote-style differences are not fabrication.
    return re.sub(r"\s+", " ", text.replace("“", '"').replace("”", '"').replace("’", "'")).strip().lower()
