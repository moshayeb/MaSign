"""The Ragas judge (MAS-91): Faithfulness and FactualCorrectness through LiteLLM.

Imported only by the `--judge` path; the api image does not carry Ragas.
Every provider call goes through one counting function so the run can
report exactly what it spent (api-spend-guard). Ragas' own usage telemetry
is switched off before it loads.
"""

from __future__ import annotations

import os
from typing import Any, Callable

from evaluation.harness import AnswerResult

os.environ.setdefault("RAGAS_DO_NOT_TRACK", "true")

DEFAULT_JUDGE_MODEL = "claude-haiku-4-5-20251001"


class CallCounter:
    """Wraps litellm.completion so each judge call is counted."""

    def __init__(self, completion: Callable[..., Any]) -> None:
        self._completion = completion
        self.calls = 0

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        return self._completion(*args, **kwargs)


def build_judge(*, provider: str, model: str, api_key: str | None) -> tuple[Callable[[AnswerResult], tuple[float | None, float | None, int]], CallCounter]:
    """A judge for `judge_answers()` plus its call counter. Needs `ragas`, `instructor` and `litellm`."""
    import instructor
    import litellm
    from ragas.llms import llm_factory
    from ragas.metrics.collections import FactualCorrectness, Faithfulness

    if api_key:
        litellm.api_key = api_key
    counter = CallCounter(litellm.completion)
    client = instructor.from_litellm(counter)
    llm = llm_factory(f"{provider}/{model}", provider=provider, client=client, adapter="litellm")
    faithfulness = Faithfulness(llm=llm)
    correctness = FactualCorrectness(llm=llm, mode="f1")

    def judge(result: AnswerResult) -> tuple[float | None, float | None, int]:
        before = counter.calls
        contexts = list(result.retrieved_texts) or [""]
        faith = faithfulness.score(user_input=result.question.question, response=result.answer, retrieved_contexts=contexts)
        correct = correctness.score(response=result.answer, reference=result.question.reference_answer)
        return _value(faith), _value(correct), counter.calls - before

    return judge, counter


def _value(metric_result: Any) -> float | None:
    value = getattr(metric_result, "value", metric_result)
    try:
        return float(value)
    except (TypeError, ValueError):
        return None
