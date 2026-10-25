"""A developer's paid provider configuration must never enable live calls in pytest."""

import pytest


@pytest.fixture(autouse=True)
def offline_analysis_environment(monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
