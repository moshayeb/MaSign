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
from app.retrieval.vector_store import ChunkHit

logger = logging.getLogger(__name__)

NOT_FOUND_TOKEN = "NOT_FOUND"
NOT_FOUND_ANSWER = "Not found in contract."
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
        return Answer(NOT_FOUND_ANSWER, grounded=False)

    completion = model.complete(
        SYSTEM_PROMPT, build_user_prompt(question, hits, filenames or {}), max_tokens=MAX_ANSWER_TOKENS
    )
    reply = completion.text

    if not completion.truncated and _says_not_found(reply):
        return Answer(NOT_FOUND_ANSWER, grounded=False, model=model.model_name)

    labels, invalid = _cited_labels(reply, len(hits))
    # The answer is shown either way; it is only *trusted* (grounded) when it
    # is complete, cites something, and every reference names a real passage.
    # Anything else is marked unverified so the UI can flag it and MAS-32 can
    # count it.
    grounded = bool(labels) and not invalid and not completion.truncated
    if not grounded:
        logger.warning(
            "Unverified answer from %s for %r (cited=%s, invalid=%s, truncated=%s): %.120r",
            model.model_name, question, labels, invalid, completion.truncated, reply,
        )
    return Answer(
        reply,
        grounded=grounded,
        citations=[Citation(label, hits[label - 1]) for label in labels],
        model=model.model_name,
    )


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
