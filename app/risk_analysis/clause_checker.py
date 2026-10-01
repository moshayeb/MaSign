"""Check a batch of passages against the expected-clause checklist (MAS-188).

Same verify-or-drop discipline as the risk analyzer and key-terms extractor:
a clause counts as present only when the model quotes it verbatim from a
numbered passage; an unreadable reply means these passages were not checked,
never "absent". Runs inside the same whole-contract review job as a third,
independent model call per batch (MAS-82's pattern): its own try/except in
`review_contract` means a clause-check failure never discards that batch's --
or any prior batch's -- already-verified risk findings or key terms, and
never marks the whole review "failed" (MAS-129).
"""

import logging
from dataclasses import dataclass
from uuid import UUID

from app.answering.grounding import build_user_prompt, passage_metadata
from app.answering.llm import ChatModel
from app.guardrails.prompt_injection import withheld_labels
from app.key_terms.clauses import CLAUSE_BY_ID, clauses_text
from app.retrieval.vector_store import ChunkHit
from app.risk_analysis.analyzer import MAX_QUOTE_CHARS, _normalise, _parse_findings, _salvage_findings

logger = logging.getLogger(__name__)

MAX_CLAUSE_TOKENS = 1024


def _system_prompt(clause_ids: tuple[str, ...]) -> str:
    return f"""You are MaSign's contract clause checker. You read numbered contract passages and report which of the listed clauses they state. You only report what the passages state; you never infer a clause that is not written.

{clauses_text(clause_ids)}

Reply with a JSON array only — no prose, no code fences. Each element:
{{"clause": "<clause id>", "passage": <passage number>, "quote": "<the clause, copied verbatim from that passage, at most {MAX_QUOTE_CHARS} characters>"}}

Rules:
1. One element per clause per passage; report the passage that states the clause, not one that merely mentions it in passing.
2. The quote must be copied exactly from the passage — no paraphrase, no ellipsis in the middle.
3. A clause the passages do not state is simply omitted. If none are stated, reply with []."""


@dataclass(frozen=True)
class ClauseFinding:
    clause_id: str
    name: str
    quote: str
    label: int  # the [n] of the passage
    hit: ChunkHit


@dataclass(frozen=True)
class ClauseReport:
    findings: list[ClauseFinding]
    # False when the reply could not be read (or nothing in it verified):
    # these passages were not checked against the clause checklist.
    checked: bool
    # False when some elements were dropped or a passage was withheld.
    complete: bool = True
    blocked: tuple[int, ...] = ()
    redacted: tuple[int, ...] = ()


def check_clauses(
    hits: list[ChunkHit],
    model: ChatModel,
    clause_ids: tuple[str, ...],
    *,
    filenames: dict[UUID, str] | None = None,
) -> ClauseReport:
    """Which of `clause_ids` are stated in `hits`, each verified against its passage. Raises only on model errors.

    `clause_ids` is the reviewed contract's effective profile's enabled
    subset of the full catalog (MAS-185-style); an empty tuple (every clause
    disabled) short-circuits with no model call at all, like an empty `hits`.
    """
    if not hits or not clause_ids:
        return ClauseReport([], checked=True)
    blocked = withheld_labels([hit.text for hit in hits])
    if len(blocked) == len(hits):
        logger.warning("All %d passage(s) withheld from clause checking; not asking the model", len(hits))
        return ClauseReport([], checked=False, complete=False, blocked=blocked)

    completion = model.complete(
        _system_prompt(clause_ids),
        build_user_prompt("Which of the listed clauses do these passages state?", hits, filenames or {}),
        max_tokens=MAX_CLAUSE_TOKENS,
        metadata=passage_metadata(hits),
    )
    # The guardrail reports what it withheld; the pre-check already knows. Keep both in step.
    blocked = tuple(sorted(set(blocked) | set(completion.blocked)))
    if completion.truncated:
        items = _salvage_findings(completion.text)
        logger.warning("Clause-check reply from %s was cut off; %d complete element(s) salvaged", model.model_name, len(items))
        if not items:
            return ClauseReport([], checked=False, complete=False, blocked=blocked)
    else:
        items = _parse_findings(completion.text)
        if items is None:
            logger.warning("Clause-check reply from %s was not a JSON array: %.200r", model.model_name, completion.text)
            return ClauseReport([], checked=False, complete=False, blocked=blocked)

    findings: list[ClauseFinding] = []
    seen: set[tuple[str, int]] = set()
    dropped = 1 if completion.truncated else 0
    for item in items:
        finding = _validate(item, hits, clause_ids)
        if finding is None:
            logger.warning("Dropped clause finding from %s: %.200r", model.model_name, item)
            dropped += 1
            continue
        if (finding.clause_id, finding.label) in seen:
            continue
        seen.add((finding.clause_id, finding.label))
        findings.append(finding)
    findings.sort(key=lambda f: (f.label, f.clause_id))
    if dropped and not findings:
        logger.warning("Clause check from %s: all %d element(s) rejected; treating as unavailable", model.model_name, dropped)
        return ClauseReport([], checked=False, complete=False, blocked=blocked)
    return ClauseReport(findings, checked=True, complete=dropped == 0 and not blocked, blocked=blocked, redacted=completion.redacted)


def _validate(item: object, hits: list[ChunkHit], clause_ids: tuple[str, ...]) -> ClauseFinding | None:
    if not isinstance(item, dict):
        return None
    clause_id = item.get("clause")
    label = item.get("passage")
    quote = item.get("quote")
    if not isinstance(clause_id, str) or clause_id not in clause_ids or clause_id not in CLAUSE_BY_ID:
        return None
    if not isinstance(label, int) or isinstance(label, bool) or not 1 <= label <= len(hits):
        return None
    if not isinstance(quote, str) or not quote.strip():
        return None
    hit = hits[label - 1]
    quote = quote.strip()[:MAX_QUOTE_CHARS]
    if _normalise(quote) not in _normalise(hit.text):
        return None
    clause = CLAUSE_BY_ID[clause_id]
    return ClauseFinding(clause_id=clause.id, name=clause.name, quote=quote, label=label, hit=hit)
