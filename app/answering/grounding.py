"""Turn retrieved passages and a question into a cited answer (MAS-13 / MAS-14).

The rule the whole tool rests on: the model may only restate what the
passages say, and every factual sentence carries the [n] of the passage it
came from. When the passages do not answer the question the model says so
with a fixed token and the user sees "Not found in contract." — no guessing.
"""

import logging
import re
from dataclasses import dataclass, field
from uuid import UUID

from app.answering.llm import ChatModel
from app.guardrails.prompt_injection import redacted_labels, withheld_labels
from app.retrieval.vector_store import ChunkHit

logger = logging.getLogger(__name__)

NOT_FOUND_TOKEN = "NOT_FOUND"
NOT_FOUND_ANSWER = "Not found in contract."
# Every retrieved passage was withheld by the guardrail: the model never saw
# the text, so "not found" would be a false claim about the contract (MAS-93).
WITHHELD_ANSWER = (
    "Could not answer: the passages matching this question were withheld from the model "
    "because they contain instructions addressed to the AI. They are listed below so you can read them yourself."
)
# Generous for "one to four sentences": running out would leave a cut-off
# answer, which is returned unverified rather than trusted (MAS-70).
MAX_ANSWER_TOKENS = 1024

SYSTEM_PROMPT = f"""You are MaSign, an assistant that answers questions about a contract using only the passages provided.

Rules:
1. Use only the passages. Do not use outside knowledge, and do not infer terms the passages do not state.
2. Every sentence that states a fact ends with the number of the passage it comes from, written like [2] or [1][3].
3. Quote amounts, percentages, periods, dates and defined terms exactly as written in the passages.
4. If the passages do not contain what is needed to answer, reply with exactly {NOT_FOUND_TOKEN} and nothing else. A partial answer is fine when the passages support part of the question; say which part is not covered.
5. Be concise: one to four sentences, no preamble, no closing remarks."""


@dataclass(frozen=True)
class Citation:
    label: int  # the [n] used in the answer text, 1-based
    hit: ChunkHit


@dataclass(frozen=True)
class Answer:
    text: str
    # True only when the answer is complete, cites at least one passage and
    # every [n] it uses names a real passage (MAS-69/70).
    grounded: bool
    citations: list[Citation] = field(default_factory=list)
    model: str | None = None
    # Passage numbers the prompt-injection guardrail withheld from the model (MAS-90).
    blocked: tuple[int, ...] = ()
    # Passage numbers read minus their injected sentences (MAS-99).
    redacted: tuple[int, ...] = ()
    # answered | not_found | withheld — the three outcomes the UI must tell apart (MAS-93).
    status: str = "answered"


def answer_question(
    question: str,
    hits: list[ChunkHit],
    model: ChatModel,
    *,
    filenames: dict[UUID, str] | None = None,
) -> Answer:
    """Answer from `hits` (best first, as the retriever returns them)."""
    if not hits:
        # Nothing to ground on: never ask the model (MAS-14).
        return Answer(NOT_FOUND_ANSWER, grounded=False, status="not_found")
    blocked = withheld_labels([hit.text for hit in hits])
    if len(blocked) == len(hits):
        # The guardrail would withhold every passage: the call would cost a
        # model round-trip to learn nothing, and "not found" would contradict
        # the text the user can see below the answer (MAS-93).
        logger.warning("All %d retrieved passage(s) withheld for %r; not asking the model", len(hits), question)
        return Answer(WITHHELD_ANSWER, grounded=False, blocked=blocked, status="withheld")

    completion = model.complete(
        SYSTEM_PROMPT,
        build_user_prompt(question, hits, filenames or {}),
        max_tokens=MAX_ANSWER_TOKENS,
        metadata=passage_metadata(hits),
    )
    reply = completion.text

    if not completion.truncated and _says_not_found(reply):
        return Answer(
            NOT_FOUND_ANSWER, grounded=False, model=model.model_name, blocked=completion.blocked, redacted=completion.redacted, status="not_found"
        )

    labels, invalid = _cited_labels(reply, len(hits))
    cited_passages = [hits[label - 1].text for label in labels]
    unsupported_values = _unsupported_financial_values(reply, cited_passages)
    # Citation syntax alone cannot prove arbitrary prose. For the concrete
    # financial values MaSign highlights, require the written value to occur
    # in a cited passage; otherwise keep showing the answer as unverified.
    grounded = bool(labels) and not invalid and not completion.truncated and not unsupported_values
    if not grounded:
        logger.warning(
            "Unverified answer from %s for %r (cited=%s, invalid=%s, truncated=%s, unsupported_values=%s): %.120r",
            model.model_name, question, labels, invalid, completion.truncated, unsupported_values, reply,
        )
    return Answer(
        reply,
        grounded=grounded,
        citations=[Citation(label, hits[label - 1]) for label in labels],
        model=model.model_name,
        blocked=completion.blocked,
        redacted=completion.redacted,
    )


def passage_metadata(hits: list[ChunkHit]) -> dict:
    """Which passage number is which chunk, for the guardrail's log lines (MAS-90)."""
    return {
        "passages": [
            {"label": number, "contract_id": str(hit.contract_id), "chunk_index": hit.chunk_index}
            for number, hit in enumerate(hits, start=1)
        ]
    }


def build_user_prompt(question: str, hits: list[ChunkHit], filenames: dict[UUID, str]) -> str:
    passages = []
    for number, hit in enumerate(hits, start=1):
        source = filenames.get(hit.contract_id, "contract")
        passages.append(f"[{number}] ({source}, passage {hit.chunk_index + 1})\n{hit.text.strip()}")
    return "Contract passages:\n\n" + "\n\n".join(passages) + f"\n\nQuestion: {question.strip()}"


def _says_not_found(reply: str) -> bool:
    head = reply.strip().strip(".").upper()
    return head == NOT_FOUND_TOKEN or head.startswith(NOT_FOUND_TOKEN + " ") or head.startswith(NOT_FOUND_TOKEN + "\n")


_CITATION = re.compile(r"\[(\d+(?:\s*,\s*\d+)*)\]")

# Deterministic claims that can be compared without asking a second model.
# These deliberately cover the contract values most dangerous to misstate;
# natural-language entailment remains part of the evaluation suite.
_FINANCIAL_VALUE = re.compile(
    r"(?ix)"
    r"(?:\b(?:EUR|USD|GBP|SEK)\s*\d[\d.,]*|[$€£]\s*\d[\d.,]*|\d[\d.,]*\s*(?:EUR|USD|GBP|SEK)\b)"
    r"|(?:\b\d+(?:[.,]\d+)?\s*%)"
    r"|(?:\b\d+(?:[.,]\d+)?\)?\s+(?:business\s+)?(?:days?|weeks?|months?|years?)\b)"
    r"|(?:\b\d{4}-\d{2}-\d{2}\b)"
    r"|(?:\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b)"
    r"|(?:\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b)"
)


def _cited_labels(reply: str, passages: int) -> tuple[list[int], list[int]]:
    """The [n] labels in the reply, split into real passages (in order of first use) and invalid ones."""
    labels: list[int] = []
    invalid: list[int] = []
    for group in _CITATION.findall(reply):
        for number in group.split(","):
            label = int(number)
            if not 1 <= label <= passages:
                if label not in invalid:
                    invalid.append(label)
            elif label not in labels:
                labels.append(label)
    return labels, invalid


def _unsupported_financial_values(reply: str, cited_passages: list[str]) -> list[str]:
    """Return concrete values in the answer that do not occur in a cited passage."""
    answer_without_citations = _CITATION.sub("", reply)
    cited_text = "\n".join(cited_passages).casefold()
    return [match.group(0) for match in _FINANCIAL_VALUE.finditer(answer_without_citations) if match.group(0).casefold() not in cited_text]
