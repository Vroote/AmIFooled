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
    "Наблюдений со страницы нет: сопоставить условия с поведением сайта не удалось. "
    "Детерминированные правила не оценивают условия документа отдельно от наблюдений."
)
NO_EVIDENCE_LIMITATION = (
    "Поведение сайта не проверено: доступны только условия переданного документа. "
    "Для сравнения с наблюдениями запустите проверку на открытой странице сайта."
)
PROVIDER_FAILED_LIMITATION = (
    "Языковая модель недоступна или вернула непроверяемый результат, поэтому "
    "показаны только детерминированные правила."
)
PROVIDER_FAILURE_REASONS = {
    "authentication": "DeepSeek не принял серверный ключ API (401).",
    "balance": "DeepSeek сообщил о недостаточном балансе API (402).",
    "rate_limit": "Провайдер ограничил частоту запросов (429); автоматических повторов нет.",
    "timeout": "Превышено время ожидания провайдера; запрос отменён.",
}
PROVIDER_DROPPED_LIMITATION = (
    "Часть ответов модели отброшена: цитата не найдена в политике или указанные "
    "наблюдения не передавались."
)
RULES_ONLY_LIMITATION = (
    "Проверка выполнена без языковой модели: сравниваются только заданные правила."
)


def _summary(findings: list[Finding], observed: bool, mode: str) -> str:
    if not observed:
        if findings:
            return (
                f"В тексте найдено {len(findings)} условие(й) для проверки. "
                "Поведение сайта не проверено; замечания относятся только к документу."
            )
        if mode == "llm":
            return (
                "Модель не выделила рисков в переданном тексте. Поведение сайта не проверено; "
                "это не заключение о безопасности сайта или полноте документа."
            )
        return NO_EVIDENCE_SUMMARY
    if not findings:
        return (
            "По переданному тексту и ограниченным наблюдениям сигналов не найдено. "
            "Это не заключение о безопасности сайта."
        )
    warnings = sum(1 for finding in findings if finding.severity == "warning")
    if warnings:
        return (
            f"Найдено {warnings} условие(й) или наблюдение(й), требующих внимания. "
            "Каждый сигнал — повод проверить детали, не доказанное нарушение."
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
    limitations = [*outcome.limitations, rules.NO_SIGNAL_LIMITATION]
    if any(item.kind == "visible_cookie_count" for item in request.evidence):
        limitations.append(rules.COOKIE_COUNT_LIMITATION)
    if any(item.kind == "resource_domain" for item in request.evidence):
        limitations.append(rules.THIRD_PARTY_LIMITATION)
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
            except ProviderError as error:
                limitations.append(PROVIDER_FAILED_LIMITATION)
                if detail := PROVIDER_FAILURE_REASONS.get(error.reason):
                    limitations.append(detail)
            else:
                verified = verify_all(proposed, request, allow_missing_quote=False)
                mode = "llm" if not proposed or verified else "rules"
                if len(verified) < len(proposed):
                    limitations.append(PROVIDER_DROPPED_LIMITATION)
                if proposed and not verified:
                    limitations.append(PROVIDER_FAILED_LIMITATION)
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
        summary=_summary(findings, outcome.observed_facts, mode),
        findings=findings,
        limitations=_dedupe(limitations),
    )
