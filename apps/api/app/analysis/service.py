"""Bounded analysis: deterministic rules first, optional provider second.

Rules always produce the answer. A configured provider may only add findings that pass
the same verification; its failure is reported as a limitation and never an error.
Request bodies and policy text are not logged or stored.
"""

from __future__ import annotations

import time
from collections.abc import Callable

import httpx

from app.models import AnalysisRequest, AnalysisResponse, Finding

from . import rules
from .config import ANALYSIS_BUDGET_SECONDS, ProviderConfig, load_provider_config
from .llm import ProviderError, request_findings
from .validate import verify_all

MIN_PROVIDER_SECONDS = 1.0

NO_EVIDENCE_SUMMARY = (
    "Наблюдений со страницы нет, поэтому сверить обещания политики с поведением сайта "
    "не удалось. Политика прочитана, но вывод по ней не делается."
)
NO_EVIDENCE_LIMITATION = (
    "Без наблюдений страницы проверка сравнивает только текст с самим собой: "
    "запустите проверку на открытой странице сайта."
)
PROVIDER_FAILED_LIMITATION = (
    "Языковая модель не ответила вовремя или вернула непроверяемый результат, поэтому "
    "показаны только детерминированные правила."
)
PROVIDER_DROPPED_LIMITATION = (
    "Часть ответов модели отброшена: цитата не найдена в политике или указанные "
    "наблюдения не передавались."
)
RULES_ONLY_LIMITATION = (
    "Проверка выполнена без языковой модели: сравниваются только заданные правила."
)


def _summary(findings: list[Finding], observed: bool) -> str:
    if not observed:
        return NO_EVIDENCE_SUMMARY
    if not findings:
        return (
            "Противоречий между переданной политикой и наблюдениями по текущим правилам "
            "не найдено. Это не заключение о безопасности сайта."
        )
    warnings = sum(1 for finding in findings if finding.severity == "warning")
    if warnings:
        return (
            f"Нашлось {warnings} расхождение(й) между тем, что обещает политика, и тем, что "
            "видно на странице. Каждое расхождение — повод проверить, не доказанное нарушение."
        )
    return (
        "Явных противоречий нет, но есть места, которые стоит сверить с политикой самостоятельно."
    )


def _dedupe(values: list[str]) -> list[str]:
    return list(dict.fromkeys(values))


def analyze_policy(
    request: AnalysisRequest,
    *,
    config: ProviderConfig | None = None,
    client: httpx.AsyncClient | None = None,
    now: Callable[[], float] = time.monotonic,
) -> AnalysisResponse:
    deadline = now() + ANALYSIS_BUDGET_SECONDS
    provider = config if config is not None else load_provider_config()

    outcome = rules.evaluate(request)
    findings = verify_all(outcome.findings, request, allow_missing_quote=True)
    limitations = list(outcome.limitations)
    mode: str = "rules"

    if provider is None:
        limitations.append(RULES_ONLY_LIMITATION)
    else:
        remaining = min(provider.timeout_seconds, deadline - now() - 0.1)
        if remaining < MIN_PROVIDER_SECONDS:
            limitations.append(PROVIDER_FAILED_LIMITATION)
        else:
            try:
                proposed = request_findings(
                    request, provider, timeout_seconds=remaining, client=client
                )
            except ProviderError:
                limitations.append(PROVIDER_FAILED_LIMITATION)
            else:
                mode = "llm"
                verified = verify_all(proposed, request, allow_missing_quote=False)
                if len(verified) < len(proposed):
                    limitations.append(PROVIDER_DROPPED_LIMITATION)
                known = {(item.title.casefold(), item.policy_quote.casefold()) for item in findings}
                findings.extend(
                    item
                    for item in verified
                    if (item.title.casefold(), item.policy_quote.casefold()) not in known
                )

    if not outcome.observed_facts:
        status = "insufficient_data"
        limitations.append(NO_EVIDENCE_LIMITATION)
    else:
        status = "ok"
        limitations.append(rules.NO_SIGNAL_LIMITATION)

    return AnalysisResponse(
        hostname=request.hostname,
        status=status,  # type: ignore[arg-type]
        mode=mode,  # type: ignore[arg-type]
        summary=_summary(findings, outcome.observed_facts),
        findings=findings,
        limitations=_dedupe(limitations),
    )
