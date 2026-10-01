"""Draft one clarifying question for a flagged risk finding (MAS-189).

The first MaSign feature where the model generates new text instead of
extracting or quoting it from the contract -- a materially different risk
than everything else here (see the MAS-189 ticket's confirm/attack/conclude
pass), so the scope is deliberately narrow: one drafted question (an RFI --
request for information) per finding, only on explicit user request, never
a replacement clause ("redline"), which is its own, not-yet-scoped decision.

Built only from the finding's own already-verified `category`/`reason`/
`quote` -- never a live, re-fetched passage -- so no new guardrail call is
needed here: `GuardedChatModel` (app/guardrails/prompt_injection.py) already
wraps every model obtained through `get_chat_model()` transparently, and
will refuse the call (`PromptInjectionError`, handled globally) if the
finding's own text still trips an injection pattern a second time.
"""

import json
import logging
from dataclasses import dataclass

from app.answering.llm import ChatModel
from app.risk_analysis.analyzer import _FENCE
from app.risk_analysis.rubric import CATEGORY_BY_ID

logger = logging.getLogger(__name__)

MAX_RFI_TOKENS = 256
MAX_QUESTION_CHARS = 400

SYSTEM_PROMPT = f"""You are MaSign's contract assistant. You read one flagged risk finding -- its category, why it was flagged, and the exact clause -- and draft ONE short, neutral question the Customer could send the other party to clarify or push back on it. You never draft replacement contract wording, only a question. You never give legal advice.

Reply with a JSON object only — no prose, no code fences: {{"question": "<the question, at most {MAX_QUESTION_CHARS} characters, plain English, addressed to the counterparty>"}}

Rules:
1. One question only, specific to the quoted clause — never generic ("please review your contract").
2. Never propose or imply specific replacement wording — ask about the clause, don't rewrite it.
3. Never claim to be a lawyer or give legal advice; a neutral, businesslike question only."""


@dataclass(frozen=True)
class RfiResult:
    question: str | None
    # False when the model's reply could not be read as a usable question.
    checked: bool


def generate_rfi(category_id: str, reason: str, quote: str, model: ChatModel) -> RfiResult:
    """One drafted clarifying question for a flagged finding. Raises only on model errors (ChatModelError)."""
    category_name = CATEGORY_BY_ID[category_id].name if category_id in CATEGORY_BY_ID else category_id
    user_prompt = (
        f"Finding category: {category_name}\n"
        f"Why it was flagged: {reason}\n"
        f'Quoted clause: "{quote}"\n\n'
        "Draft the clarifying question."
    )
    completion = model.complete(SYSTEM_PROMPT, user_prompt, max_tokens=MAX_RFI_TOKENS)
    text = _FENCE.sub("", completion.text.strip())
    try:
        data = json.loads(text)
    except ValueError:
        logger.warning("RFI reply from %s was not valid JSON: %.200r", model.model_name, completion.text)
        return RfiResult(None, checked=False)
    question = data.get("question") if isinstance(data, dict) else None
    if not isinstance(question, str) or not question.strip():
        logger.warning("RFI reply from %s had no usable question: %.200r", model.model_name, completion.text)
        return RfiResult(None, checked=False)
    return RfiResult(question.strip()[:MAX_QUESTION_CHARS], checked=True)
