"""The 15-second budget and the finding validator."""

from app.analysis.config import ProviderConfig
from app.analysis.service import PROVIDER_FAILED_LIMITATION, analyze_policy
from app.analysis.validate import verify_finding
from app.models import AnalysisRequest, Evidence, Finding

CONFIG = ProviderConfig(
    api_key="test-key-not-real",
    base_url="https://provider.invalid",
    model="test-model",
    timeout_seconds=12.0,
)


def build_request() -> AnalysisRequest:
    return AnalysisRequest(
        hostname="shop.example.com",
        policy_text="Мы не передаём данные третьим лицам.",
        evidence=[
            Evidence(
                id="r1",
                kind="resource_domain",
                value="metrics.tracker.net",
                limitation="Ограниченное наблюдение.",
            )
        ],
    )


def test_exhausted_budget_skips_the_provider_instead_of_hanging():
    ticks = iter([0.0, 14.8, 14.9, 15.0])

    def fake_now() -> float:
        return next(ticks)

    response = analyze_policy(build_request(), config=CONFIG, now=fake_now)
    assert response.mode == "rules"
    assert PROVIDER_FAILED_LIMITATION in response.limitations
    assert len(response.findings) == 1


def test_provider_timeout_is_capped_below_the_total_budget():
    assert CONFIG.timeout_seconds < 15.0


def test_validator_requires_a_quote_from_the_provider_but_allows_rule_absence():
    request = build_request()
    absence = Finding(
        title="Нет упоминания",
        explanation="Политика не упоминает cookie.",
        severity="info",
        policy_quote="",
        evidence_ids=["r1"],
    )
    assert verify_finding(absence, request, allow_missing_quote=True) is not None
    assert verify_finding(absence, request, allow_missing_quote=False) is None


def test_validator_drops_unknown_evidence_but_keeps_findings_without_any():
    request = build_request()
    unknown = Finding(
        title="Ссылка на чужое наблюдение",
        explanation="Указан неизвестный id.",
        severity="info",
        policy_quote="не передаём данные третьим лицам",
        evidence_ids=["ghost"],
    )
    assert verify_finding(unknown, request, allow_missing_quote=False) is None

    without_evidence = unknown.model_copy(update={"evidence_ids": []})
    assert verify_finding(without_evidence, request, allow_missing_quote=False) is not None


def test_validator_restores_the_exact_casing_of_the_policy():
    request = build_request()
    finding = Finding(
        title="Регистр",
        explanation="Провайдер изменил регистр цитаты.",
        severity="info",
        policy_quote="НЕ ПЕРЕДАЁМ ДАННЫЕ ТРЕТЬИМ ЛИЦАМ",
        evidence_ids=[],
    )
    checked = verify_finding(finding, request, allow_missing_quote=False)
    assert checked is not None
    assert checked.policy_quote == "не передаём данные третьим лицам"


def test_validator_truncates_an_overlong_explanation():
    request = build_request()
    finding = Finding(
        title="Длинно",
        explanation="слово " * 400,
        severity="info",
        policy_quote="не передаём данные третьим лицам",
        evidence_ids=[],
    )
    checked = verify_finding(finding, request, allow_missing_quote=False)
    assert checked is not None
    assert len(checked.explanation) <= 700
