"""Rules produce checkable signals and never invent quotes or evidence."""

from app.analysis import analyze_policy
from app.analysis.rules import evaluate
from app.analysis.text import is_third_party
from app.models import AnalysisRequest, Evidence

LIMITATION = "Ограниченное наблюдение страницы."


def evidence(id_: str, kind: str, value: str) -> Evidence:
    return Evidence(id=id_, kind=kind, value=value, limitation=LIMITATION)


def request(policy: str, items: list[Evidence], hostname: str = "shop.example.com"):
    return AnalysisRequest(hostname=hostname, policy_text=policy, evidence=items)


def test_promise_not_to_share_contradicts_third_party_resources():
    policy = "Мы заботимся о вас. Мы не передаём данные третьим лицам. Спасибо."
    result = evaluate(request(policy, [evidence("r1", "resource_domain", "metrics.tracker.net")]))
    assert len(result.findings) == 1
    finding = result.findings[0]
    assert finding.severity == "warning"
    assert finding.policy_quote in policy
    assert finding.policy_quote == "не передаём данные третьим лицам"
    assert finding.evidence_ids == ["r1"]


def test_same_site_resource_is_not_reported_as_third_party():
    policy = "Мы не передаём данные третьим лицам."
    result = evaluate(request(policy, [evidence("r1", "resource_domain", "cdn.example.com")]))
    assert result.findings == []


def test_disclosed_sharing_is_info_not_a_contradiction():
    policy = "Мы можем передавать данные партнёрам для аналитики."
    result = evaluate(request(policy, [evidence("r1", "resource_domain", "ads.partner.net")]))
    assert [finding.severity for finding in result.findings] == ["info"]
    assert result.findings[0].policy_quote in policy


def test_cookie_denial_contradicts_visible_cookies():
    policy = "Мы не используем cookie."
    result = evaluate(request(policy, [evidence("c1", "visible_cookie_count", "4")]))
    assert len(result.findings) == 1
    assert result.findings[0].severity == "warning"
    assert "4 cookie" in result.findings[0].explanation
    assert result.findings[0].policy_quote in policy


def test_silent_policy_with_cookies_reports_absence_without_a_fabricated_quote():
    policy = "Мы обрабатываем данные для оказания услуг."
    result = evaluate(request(policy, [evidence("c1", "visible_cookie_count", "2")]))
    assert len(result.findings) == 1
    assert result.findings[0].policy_quote == ""
    assert result.findings[0].evidence_ids == ["c1"]


def test_zero_visible_cookies_produces_no_cookie_finding():
    policy = "Мы обрабатываем данные для оказания услуг."
    result = evaluate(request(policy, [evidence("c1", "visible_cookie_count", "0")]))
    assert result.findings == []


def test_neutral_policy_without_matching_facts_has_no_findings():
    policy = "Мы используем cookie и раскрываем это в документе."
    response = analyze_policy(request(policy, [evidence("c1", "visible_cookie_count", "3")]))
    assert response.findings == []
    assert response.status == "ok"
    assert "не означает" in " ".join(response.limitations)


def test_missing_evidence_is_insufficient_data():
    response = analyze_policy(request("Мы не передаём данные третьим лицам.", []))
    assert response.status == "insufficient_data"
    assert response.findings == []


def test_english_policy_is_also_matched():
    policy = "We do not share your data with third parties."
    result = evaluate(request(policy, [evidence("r1", "resource_domain", "pixel.adtech.io")]))
    assert len(result.findings) == 1
    assert result.findings[0].policy_quote in policy


def test_third_party_comparison_handles_www_and_subdomains():
    assert is_third_party("tracker.net", "example.com") is True
    assert is_third_party("www.example.com", "example.com") is False
    assert is_third_party("a.b.example.com", "example.com") is False
    assert is_third_party("", "example.com") is False
