"""Check a present clause's CONTENT against a configured policy rule (MAS-192).

MAS-188 already checks clause *presence* (liability_cap stated or not); this
checks what a present clause actually *says* against a free-text rule a
workspace configures per (standard profile, clause) — e.g. "the liability cap
must not exceed 12 months of the annual fee". A rule only ever judges a
clause the clause-checker (`check_clauses`) already found present in this
same batch, against that finding's own already-verified quote — never a
clause that was absent or never asked about, and never a sentence the model
invents. Independent model call and failure domain from risk grading, key
terms and clause presence (MAS-129/MAS-188 pattern): a bad reply here only
marks the policy pass incomplete for this batch, never discards any
already-verified finding from another pass. Zero-cost short-circuit when
this batch found no clause with a configured rule — no call, no row.

The quotes judged here are substrings of a passage the clause-checker already
validated against the (guardrail-redacted) chunk text in this same batch, so
there is nothing further for the prompt-injection guardrail to withhold —
re-verifying is still done here (`_normalise` substring check against the
originating `ClauseFinding.quote`), just not re-run through the guardrail.
"""

import json
import logging
import re
from dataclasses import dataclass

from app.answering.llm import ChatModel
from app.key_terms.clauses import CLAUSE_BY_ID
from app.risk_analysis.analyzer import MAX_QUOTE_CHARS, _normalise, _salvage_findings
from app.risk_analysis.clause_checker import ClauseFinding

logger = logging.getLogger(__name__)

MAX_POLICY_TOKENS = 1024
VERDICTS = ("compliant", "violated", "cannot_tell")
_FENCE = re.compile(r"^```[a-zA-Z]*\n?|```$", re.MULTILINE)


def _system_prompt(rules: dict[str, str]) -> str:
    rule_lines = "\n".join(f"- {clause_id} ({CLAUSE_BY_ID[clause_id].name}): {rule_text}" for clause_id, rule_text in rules.items())
    return f"""You are MaSign's contract policy checker. You read short clause excerpts and judge whether each complies with its stated rule, using only the excerpt's own text. You never infer facts the excerpt does not state.

Rules to check (one per clause id; never invent a rule for a clause not listed):
{rule_lines}

Reply with a JSON array only — no prose, no code fences. Each element:
{{"item": <item number from the list below>, "clause": "<clause id>", "verdict": "compliant" | "violated" | "cannot_tell", "quote": "<the part of the excerpt your verdict is based on, copied verbatim, at most {MAX_QUOTE_CHARS} characters>"}}

Rules:
1. One element per item you were given — judge every one, never skip or merge.
2. "cannot_tell" only when the excerpt genuinely does not say enough to judge the rule — never guess compliant or violated.
3. The quote must be copied exactly from that item's excerpt — no paraphrase, no ellipsis in the middle."""


def _user_prompt(findings: list[ClauseFinding]) -> str:
    lines = ["Judge each numbered clause excerpt against its rule."]
    for i, finding in enumerate(findings, start=1):
        lines.append(f"\n[{i}] clause={finding.clause_id}\n{finding.quote}")
    return "\n".join(lines)


def _parse_items(text: str) -> list | None:
    try:
        data = json.loads(_FENCE.sub("", text.strip()))
    except ValueError:
        return None
    return data if isinstance(data, list) else None


@dataclass(frozen=True)
class PolicyFinding:
    clause_id: str
    verdict: str
    quote: str
    source: ClauseFinding  # the clause finding this verdict judged; carries chunk_id/label/hit for citation


@dataclass(frozen=True)
class PolicyReport:
    findings: list[PolicyFinding]
    # False when the reply could not be read: these clause findings were not
    # checked against their configured rule — "cannot_tell" at the caller,
    # never "compliant" or a stale verdict.
    checked: bool
    complete: bool = True


def check_policy_rules(clause_findings: list[ClauseFinding], rules: dict[str, str], model: ChatModel) -> PolicyReport:
    """Judge each of `clause_findings` whose clause has a configured rule in `rules`.

    `rules` is the reviewed profile's clause_id -> rule_text map, already
    filtered to non-empty rules by the caller. A clause finding with no
    configured rule is simply not sent — there is nothing to judge, and no
    row is produced for it (the caller's `not_applicable` default covers it).
    """
    relevant = [f for f in clause_findings if f.clause_id in rules]
    if not relevant:
        return PolicyReport([], checked=True)

    completion = model.complete(
        _system_prompt({cid: rules[cid] for cid in dict.fromkeys(f.clause_id for f in relevant)}),
        _user_prompt(relevant),
        max_tokens=MAX_POLICY_TOKENS,
    )
    if completion.truncated:
        items = _salvage_findings(completion.text)
        logger.warning("Policy-check reply from %s was cut off; %d complete element(s) salvaged", model.model_name, len(items))
        if not items:
            return PolicyReport([], checked=False, complete=False)
    else:
        items = _parse_items(completion.text)
        if items is None:
            logger.warning("Policy-check reply from %s was not a JSON array: %.200r", model.model_name, completion.text)
            return PolicyReport([], checked=False, complete=False)

    findings: list[PolicyFinding] = []
    seen: set[int] = set()
    dropped = 1 if completion.truncated else 0
    for item in items:
        finding = _validate(item, relevant)
        if finding is None:
            logger.warning("Dropped policy finding from %s: %.200r", model.model_name, item)
            dropped += 1
            continue
        index = relevant.index(finding.source)
        if index in seen:
            continue
        seen.add(index)
        findings.append(finding)
    if dropped and not findings:
        logger.warning("Policy check from %s: all %d element(s) rejected; treating as unavailable", model.model_name, dropped)
        return PolicyReport([], checked=False, complete=False)
    # Complete only when every relevant clause finding got a judged verdict —
    # a partial reply means the rest must read "cannot_tell", not silence.
    return PolicyReport(findings, checked=True, complete=len(findings) == len(relevant))


def _validate(item: object, relevant: list[ClauseFinding]) -> PolicyFinding | None:
    if not isinstance(item, dict):
        return None
    index = item.get("item")
    clause_id = item.get("clause")
    verdict = item.get("verdict")
    quote = item.get("quote")
    if not isinstance(index, int) or isinstance(index, bool) or not 1 <= index <= len(relevant):
        return None
    source = relevant[index - 1]
    if not isinstance(clause_id, str) or clause_id != source.clause_id:
        return None
    if verdict not in VERDICTS:
        return None
    if not isinstance(quote, str) or not quote.strip():
        return None
    quote = quote.strip()[:MAX_QUOTE_CHARS]
    if _normalise(quote) not in _normalise(source.quote):
        return None
    return PolicyFinding(clause_id=clause_id, verdict=verdict, quote=quote, source=source)
