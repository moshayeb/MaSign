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
    """Wraps litellm.acompletion so each judge call is counted.

    Must stay `async def`, not a sync method that happens to return an
    awaitable: instructor.from_litellm() and, in turn, ragas's own
    `_check_client_async()` both decide sync vs. async purely from
    `inspect.iscoroutinefunction(completion)` on this callable -- never run
    for real to check. ragas's public `score()` always calls its async
    `ascore()` internally (`asyncio.run(...)`) regardless, and `ascore()`
    refuses to run at all against a client that inspected as synchronous
    ("Cannot use agenerate() with a synchronous client") -- a real, never
    actually run end-to-end until MAS-32 exercised --judge --yes for the
    first time. litellm.completion (sync) would produce exactly that
    failure the moment a judged run was ever attempted.
    """

    def __init__(self, completion: Callable[..., Any]) -> None:
        self._completion = completion
        self.calls = 0

    async def __call__(self, *args: Any, **kwargs: Any) -> Any:
        self.calls += 1
        return await self._completion(*args, **kwargs)


def build_judge(*, provider: str, model: str, api_key: str | None) -> tuple[Callable[[AnswerResult], tuple[float | None, float | None, int]], CallCounter]:
    """A judge for `judge_answers()` plus its call counter. Needs `ragas`, `instructor` and `litellm`."""
    import instructor
    import litellm
    from ragas.llms import llm_factory
    from ragas.metrics.collections import FactualCorrectness, Faithfulness

    if api_key:
        litellm.api_key = api_key
    counter = CallCounter(litellm.acompletion)
    # instructor.from_litellm() (and, independently, patch_v2 underneath it)
    # decide sync vs. async by inspect.iscoroutinefunction(completion) --
    # which is False for a callable *instance*, even one whose __call__ is
    # `async def`, because inspect does not unwrap __call__ for that check.
    # Passing `counter` itself silently builds a synchronous create_fn that
    # calls the coroutine without awaiting it and hands the raw, unawaited
    # coroutine object to the response parser ("No choices in OpenAI
    # response") -- passing async_client=True alone does not fix this, since
    # patch_v2's own dispatch has the identical blind spot. The bound
    # method, `counter.__call__`, passes the same inspection correctly.
    client = instructor.from_litellm(counter.__call__, async_client=True)
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
