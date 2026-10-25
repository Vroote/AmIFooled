"""Deterministic signals: compare what the policy promises with what was observed.

A rule may only produce a finding when it can point at a real substring of the policy
(or honestly report that the policy never mentions the subject) and at evidence ids the
collector actually sent. Nothing here concludes fraud or a legal violation.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models import AnalysisRequest, Evidence, Finding

from .text import collapse_whitespace, find_exact_quote, is_third_party

_SENTENCE_GAP = r"[^.!?\n]{0,120}?"

NO_THIRD_PARTY_SHARING = re.compile(
    r"(?:не\s+(?:переда[ёе]м|переда[ёе]т|передаются|предоставляем|раскрываем|делимся|прода[ёе]м)"
    rf"{_SENTENCE_GAP}"
    r"(?:треть[а-яё]+\s+(?:лицам|лиц|сторонам|сторон)|партн[ёе]р[а-яё]*"
    r"|сторонним\s+(?:сервисам|компаниям|организациям|лицам)))"
    r"|(?:do(?:es)?\s+not\s+(?:share|sell|disclose|transfer|provide)"
    rf"{_SENTENCE_GAP}"
    r"(?:third[-\s]part(?:y|ies)|partners|advertisers))",
    re.IGNORECASE,
)

DISCLOSED_SHARING = re.compile(
    r"(?:(?:можем\s+)?(?:переда(?:ва)?(?:ть|[ёе]м)|предоставля(?:ть|ем)|раскрыва(?:ть|ем)|делимся)"
    rf"{_SENTENCE_GAP}"
    r"(?:треть[а-яё]+\s+(?:лицам|лиц|сторонам|сторон)|партн[ёе]р[а-яё]*))"
    r"|(?:(?:we\s+)?(?:may\s+)?(?:share|disclose|transfer|provide)"
    rf"{_SENTENCE_GAP}"
    r"(?:third[-\s]part(?:y|ies)|partners))",
    re.IGNORECASE,
)

COOKIE_DENIAL = re.compile(
    r"(?:не\s+(?:используем|применяем|устанавливаем|храним)"
    rf"{_SENTENCE_GAP}"
    r"(?:cookie|куки|файл[а-яё]*\s+cookie))"
    r"|(?:do(?:es)?\s+not\s+(?:use|set|store)" + _SENTENCE_GAP + r"cookies)",
    re.IGNORECASE,
)

COOKIE_MENTION = re.compile(r"cookie|куки|куков|кук[аи]\b", re.IGNORECASE)

THIRD_PARTY_LIMITATION = (
    "Сторонний домен на странице не доказывает передачу персональных данных: ресурс может "
    "быть CDN или шрифтом. Это сигнал для проверки, не вывод о нарушении."
)
TWO_LABEL_LIMITATION = (
    "«Свой» и «сторонний» домен различаются по двум последним меткам без Public Suffix "
    "List, поэтому хосты на общих суффиксах могут быть отнесены к сайту неточно."
)
COOKIE_COUNT_LIMITATION = (
    "Учитывается только количество cookie, доступных JavaScript: HttpOnly и часть "
    "сторонних cookie в это число не попадают."
)
NO_SIGNAL_LIMITATION = (
    "Отсутствие сигнала не означает, что сайт безопасен: проверяются только "
    "перечисленные правила и переданные наблюдения."
)


@dataclass(frozen=True)
class RulesResult:
    findings: list[Finding]
    limitations: list[str]
    compared_promises: bool
    observed_facts: bool


def _third_party_domains(request: AnalysisRequest) -> list[Evidence]:
    return [
        item
        for item in request.evidence
        if item.kind == "resource_domain" and is_third_party(item.value, request.hostname)
    ]


def _visible_cookie_counts(request: AnalysisRequest) -> list[tuple[Evidence, int]]:
    counted: list[tuple[Evidence, int]] = []
    for item in request.evidence:
        if item.kind != "visible_cookie_count":
            continue
        digits = item.value.strip()
        if digits.isascii() and digits.isdecimal():
            counted.append((item, int(digits)))
    return counted


def _domain_list(evidence: list[Evidence], limit: int = 5) -> str:
    names = [collapse_whitespace(item.value) for item in evidence[:limit]]
    suffix = f" и ещё {len(evidence) - limit}" if len(evidence) > limit else ""
    return ", ".join(names) + suffix


def evaluate(request: AnalysisRequest) -> RulesResult:
    policy = request.policy_text
    findings: list[Finding] = []
    limitations: list[str] = []

    third_party = _third_party_domains(request)
    cookie_counts = _visible_cookie_counts(request)
    visible_cookies = sum(count for _, count in cookie_counts)

    denial = NO_THIRD_PARTY_SHARING.search(policy)
    if denial and third_party:
        findings.append(
            Finding(
                title="Обещание не передавать данные и сторонние ресурсы на странице",
                explanation=(
                    "Политика утверждает, что данные не передаются третьим лицам, а страница "
                    f"обращается к сторонним доменам: {_domain_list(third_party)}. "
                    "Стоит выяснить назначение этих ресурсов и то, какие данные они получают."
                ),
                severity="warning",
                policy_quote=policy[denial.start() : denial.end()],
                evidence_ids=[item.id for item in third_party],
            )
        )
        limitations.extend([THIRD_PARTY_LIMITATION, TWO_LABEL_LIMITATION])
    elif third_party:
        disclosed = DISCLOSED_SHARING.search(policy)
        if disclosed:
            findings.append(
                Finding(
                    title="Передача третьим лицам заявлена в политике",
                    explanation=(
                        "Политика допускает передачу данных третьим лицам, и страница "
                        f"обращается к сторонним доменам: {_domain_list(third_party)}. "
                        "Противоречия нет; проверьте, перечислены ли эти получатели."
                    ),
                    severity="info",
                    policy_quote=policy[disclosed.start() : disclosed.end()],
                    evidence_ids=[item.id for item in third_party],
                )
            )
            limitations.extend([THIRD_PARTY_LIMITATION, TWO_LABEL_LIMITATION])

    cookie_denial = COOKIE_DENIAL.search(policy)
    if cookie_counts and visible_cookies > 0:
        cookie_ids = [item.id for item, count in cookie_counts if count > 0]
        if cookie_denial:
            findings.append(
                Finding(
                    title="Политика отрицает cookie, но cookie доступны на странице",
                    explanation=(
                        f"Политика заявляет, что cookie не используются, при этом JavaScript "
                        f"видит {visible_cookies} cookie. Это повод уточнить назначение этих "
                        "cookie."
                    ),
                    severity="warning",
                    policy_quote=policy[cookie_denial.start() : cookie_denial.end()],
                    evidence_ids=cookie_ids,
                )
            )
            limitations.append(COOKIE_COUNT_LIMITATION)
        elif not COOKIE_MENTION.search(policy):
            findings.append(
                Finding(
                    title="Cookie есть на странице, но в политике не упомянуты",
                    explanation=(
                        f"JavaScript видит {visible_cookies} cookie, а переданный текст политики "
                        "ни разу не упоминает cookie. Возможно, это другой раздел документа — "
                        "проверьте полную версию политики."
                    ),
                    severity="warning",
                    # Absence of a statement has no quote; the gap itself is the signal.
                    policy_quote="",
                    evidence_ids=cookie_ids,
                )
            )
            limitations.append(COOKIE_COUNT_LIMITATION)

    return RulesResult(
        findings=findings,
        limitations=limitations,
        compared_promises=bool(denial or cookie_denial or DISCLOSED_SHARING.search(policy)),
        observed_facts=bool(third_party or cookie_counts),
    )


__all__ = [
    "NO_SIGNAL_LIMITATION",
    "RulesResult",
    "evaluate",
    "find_exact_quote",
]
