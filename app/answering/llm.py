"""The chat model that writes answers (MAS-13), called through LiteLLM (MAS-90).

One small interface. CHAT_PROVIDER picks Anthropic (default) or OpenAI,
CHAT_MODEL the model; switching is a config change because the prompt lives
in `grounding.py` and nothing about the model is stored. Every call goes
through `litellm.completion()`, and every production model is wrapped in the
prompt-injection guardrail (`app/guardrails/prompt_injection.py`). Tests use
a fake, so no key is needed there.
"""

import logging
import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Callable, Protocol

logger = logging.getLogger(__name__)

PROVIDERS = ("anthropic", "openai")
DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5", "openai": "gpt-4.1-mini"}
KEY_VARIABLES = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}
PROVIDER_LABELS = {"anthropic": "Anthropic", "openai": "OpenAI"}


class ChatModelError(RuntimeError):
    """The model could not be used: not configured, unreachable, or refused the call.

    The message is readable and reaches the client as the 503 `detail`.
    """


@dataclass(frozen=True)
class Completion:
    text: str
    # Generation stopped at max_tokens: the text is incomplete and must not be
    # trusted as a finished answer (MAS-70).
    truncated: bool = False
    # Passage numbers the guardrail withheld from the prompt (MAS-90).
    blocked: tuple[int, ...] = ()


class ChatModel(Protocol):
    provider: str
    model_name: str

    def complete(self, system: str, user: str, *, max_tokens: int, metadata: dict | None = None) -> Completion:
        """One system prompt, one user message, the model's reply.

        `metadata` describes the passages in the user message for the
        guardrail's log lines; it is never sent to the provider.
        Raises ChatModelError when the model cannot be used or returns no text.
        """
        ...


def _completion(text: str, truncated: bool, model_name: str) -> Completion:
    text = text.strip()
    if not text:
        raise ChatModelError(f"{model_name} returned an empty answer.")
    return Completion(text, truncated=truncated)


class LiteLLMChatModel:
    """Any provider LiteLLM speaks, addressed as `<provider>/<model>`."""

    def __init__(
        self,
        provider: str,
        model_name: str,
        api_key: str,
        completion_fn: Callable[..., Any] | None = None,
    ) -> None:
        self.provider = provider
        self.model_name = model_name
        self._api_key = api_key
        # Injected in tests; `litellm.completion` otherwise.
        self._completion_fn = completion_fn

    def complete(self, system: str, user: str, *, max_tokens: int, metadata: dict | None = None) -> Completion:
        import litellm
        import openai

        litellm.suppress_debug_info = True
        call = self._completion_fn or litellm.completion
        label = PROVIDER_LABELS[self.provider]
        extra: dict[str, Any] = {}
        if self.provider == "anthropic":
            # Sonnet 5 thinks adaptively by default and that would share
            # max_tokens with the answer; extractive Q&A over a handful of
            # passages does not need it (MAS-70).
            extra["thinking"] = {"type": "disabled"}
        try:
            response = call(
                model=f"{self.provider}/{self.model_name}",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                max_tokens=max_tokens,
                api_key=self._api_key,
                drop_params=True,  # a provider that lacks a parameter gets the call without it
                **extra,
            )
        except litellm.APIConnectionError as error:
            raise ChatModelError(f"{label} API is unreachable: {error}") from error
        except openai.APIError as error:  # every LiteLLM provider error derives from these
            status = getattr(error, "status_code", None)
            reason = f"HTTP {status}" if status else type(error).__name__
            raise ChatModelError(f"{label} API refused the request ({reason}): {getattr(error, 'message', error)}") from error
        choice = response.choices[0]
        return _completion(choice.message.content or "", choice.finish_reason == "length", self.model_name)


class UnconfiguredChatModel:
    """Stands in when no API key is set: uploads and retrieval keep working, answers do not."""

    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.model_name = "unconfigured"
        self.key_variable = KEY_VARIABLES[provider]

    def complete(self, system: str, user: str, *, max_tokens: int, metadata: dict | None = None) -> Completion:
        raise ChatModelError(
            f"Answer generation is not configured: set {self.key_variable} (CHAT_PROVIDER={self.provider})."
        )


@lru_cache(maxsize=1)
def get_chat_model() -> ChatModel:
    provider = os.getenv("CHAT_PROVIDER", DEFAULT_PROVIDER)
    if provider not in PROVIDERS:
        raise ValueError(f"CHAT_PROVIDER={provider!r} is not one of {PROVIDERS}.")
    model_name = os.getenv("CHAT_MODEL") or DEFAULT_MODELS[provider]
    api_key = os.getenv(KEY_VARIABLES[provider])
    if not api_key:
        logger.warning("%s is not set: /api/query will not generate answers until it is", KEY_VARIABLES[provider])
        return UnconfiguredChatModel(provider)
    logger.info("Chat model: %s %s via LiteLLM, prompt-injection guardrail on", provider, model_name)
    from app.guardrails.prompt_injection import GuardedChatModel  # avoids an import cycle

    return GuardedChatModel(LiteLLMChatModel(provider, model_name, api_key))
