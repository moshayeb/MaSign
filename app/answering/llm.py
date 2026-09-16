"""The chat model that writes answers (MAS-13).

One small interface, two providers. CHAT_PROVIDER picks Anthropic (default)
or OpenAI, CHAT_MODEL the model; switching is a config change because the
prompt lives in `grounding.py` and nothing about the model is stored. Tests
use a fake, so no key is needed there.
"""

import logging
import os
from functools import lru_cache
from typing import Any, Protocol

logger = logging.getLogger(__name__)

PROVIDERS = ("anthropic", "openai")
DEFAULT_PROVIDER = "anthropic"
DEFAULT_MODELS = {"anthropic": "claude-sonnet-5", "openai": "gpt-4.1-mini"}
KEY_VARIABLES = {"anthropic": "ANTHROPIC_API_KEY", "openai": "OPENAI_API_KEY"}


class ChatModelError(RuntimeError):
    """The model could not be used: not configured, unreachable, or refused the call.

    The message is readable and reaches the client as the 503 `detail`.
    """


class ChatModel(Protocol):
    provider: str
    model_name: str

    def complete(self, system: str, user: str, *, max_tokens: int) -> str:
        """One system prompt, one user message, the model's text reply."""
        ...


class AnthropicChatModel:
    provider = "anthropic"

    def __init__(self, model_name: str, api_key: str, client: Any = None) -> None:
        self.model_name = model_name
        self._api_key = api_key
        self._client = client

    def _sdk(self):
        if self._client is None:
            import anthropic

            self._client = anthropic.Anthropic(api_key=self._api_key)
        return self._client

    def complete(self, system: str, user: str, *, max_tokens: int) -> str:
        import anthropic

        try:
            response = self._sdk().messages.create(
                model=self.model_name,
                max_tokens=max_tokens,
                system=system,
                messages=[{"role": "user", "content": user}],
            )
        except anthropic.APIStatusError as error:
            raise ChatModelError(f"Anthropic API refused the request (HTTP {error.status_code}): {error.message}") from error
        except anthropic.APIConnectionError as error:
            raise ChatModelError(f"Anthropic API is unreachable: {error}") from error
        return "".join(block.text for block in response.content if getattr(block, "type", "") == "text").strip()


class OpenAIChatModel:
    provider = "openai"

    def __init__(self, model_name: str, api_key: str, client: Any = None) -> None:
        self.model_name = model_name
        self._api_key = api_key
        self._client = client

    def _sdk(self):
        if self._client is None:
            import openai

            self._client = openai.OpenAI(api_key=self._api_key)
        return self._client

    def complete(self, system: str, user: str, *, max_tokens: int) -> str:
        import openai

        try:
            response = self._sdk().chat.completions.create(
                model=self.model_name,
                max_completion_tokens=max_tokens,
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            )
        except openai.APIStatusError as error:
            raise ChatModelError(f"OpenAI API refused the request (HTTP {error.status_code}): {error.message}") from error
        except openai.APIConnectionError as error:
            raise ChatModelError(f"OpenAI API is unreachable: {error}") from error
        return (response.choices[0].message.content or "").strip()


class UnconfiguredChatModel:
    """Stands in when no API key is set: uploads and retrieval keep working, answers do not."""

    def __init__(self, provider: str) -> None:
        self.provider = provider
        self.model_name = "unconfigured"
        self.key_variable = KEY_VARIABLES[provider]

    def complete(self, system: str, user: str, *, max_tokens: int) -> str:
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
    logger.info("Chat model: %s %s", provider, model_name)
    if provider == "anthropic":
        return AnthropicChatModel(model_name, api_key)
    return OpenAIChatModel(model_name, api_key)
