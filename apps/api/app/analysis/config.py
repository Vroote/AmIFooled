"""Provider configuration read from the server environment only.

The key never reaches the extension bundle, a response body, a log line, or an error
message. Without a key the service stays in deterministic rules mode.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from urllib.parse import urlparse

DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_MODEL = "deepseek-flash"
DEFAULT_TIMEOUT_SECONDS = 12.0
ANALYSIS_BUDGET_SECONDS = 15.0
MAX_REQUEST_BODY_BYTES = 256 * 1024

_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})


@dataclass(frozen=True)
class ProviderConfig:
    api_key: str = field(repr=False)
    base_url: str
    model: str
    timeout_seconds: float

    @property
    def completions_url(self) -> str:
        # Both DeepSeek's root and its /v1 compatibility base are valid API bases.
        return f"{self.base_url.rstrip('/')}/chat/completions"


def _positive_float(raw: str | None, fallback: float) -> float:
    try:
        value = float(raw) if raw else fallback
    except ValueError:
        return fallback
    return value if value > 0 else fallback


def load_provider_config(env: dict[str, str] | None = None) -> ProviderConfig | None:
    source = os.environ if env is None else env
    api_key = (source.get("LLM_API_KEY") or "").strip()
    if not api_key:
        return None

    base_url = (source.get("LLM_BASE_URL") or DEFAULT_BASE_URL).strip().rstrip("/")
    parsed = urlparse(base_url)
    if parsed.scheme == "http" and (parsed.hostname or "") not in _LOOPBACK_HOSTS:
        # Refuse to send a server key over plaintext to a remote host.
        return None
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        return None
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        return None

    timeout = min(
        _positive_float(source.get("LLM_TIMEOUT_SECONDS"), DEFAULT_TIMEOUT_SECONDS),
        ANALYSIS_BUDGET_SECONDS - 1.0,
    )
    return ProviderConfig(
        api_key=api_key,
        base_url=base_url,
        model=(source.get("LLM_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL,
        timeout_seconds=timeout,
    )
