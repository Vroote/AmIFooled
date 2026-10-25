"""Drop every finding that cannot be checked against the submitted request.

Unverifiable output is removed rather than softened: a quote that is not in the policy
or an evidence id that was never sent is treated as fabricated.
"""

from __future__ import annotations

from app.models import AnalysisRequest, Finding

from .text import find_exact_quote

ALLOWED_SEVERITIES = ("info", "warning")
MAX_TITLE_LENGTH = 160
MAX_EXPLANATION_LENGTH = 700


def _clip(value: str, limit: int) -> str:
    collapsed = " ".join(value.split())
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: limit - 1].rstrip() + "…"


def verify_finding(
    finding: Finding,
    request: AnalysisRequest,
    *,
    allow_missing_quote: bool,
) -> Finding | None:
    if finding.severity not in ALLOWED_SEVERITIES:
        return None

    title = _clip(finding.title, MAX_TITLE_LENGTH)
    explanation = _clip(finding.explanation, MAX_EXPLANATION_LENGTH)
    if not title or not explanation:
        return None

    quote = finding.policy_quote.strip()
    if quote:
        exact = find_exact_quote(request.policy_text, quote)
        if exact is None:
            return None
        quote = exact
    elif not allow_missing_quote:
        return None

    known_ids = {item.id for item in request.evidence}
    if any(value not in known_ids for value in finding.evidence_ids):
        return None
    evidence_ids = list(dict.fromkeys(finding.evidence_ids))

    return Finding(
        title=title,
        explanation=explanation,
        severity=finding.severity,
        policy_quote=quote,
        evidence_ids=evidence_ids,
    )


def verify_all(
    findings: list[Finding],
    request: AnalysisRequest,
    *,
    allow_missing_quote: bool,
) -> list[Finding]:
    verified: list[Finding] = []
    seen: set[tuple[str, str]] = set()
    for finding in findings:
        checked = verify_finding(finding, request, allow_missing_quote=allow_missing_quote)
        if checked is None:
            continue
        key = (checked.title.casefold(), checked.policy_quote.casefold())
        if key in seen:
            continue
        seen.add(key)
        verified.append(checked)
    return verified
