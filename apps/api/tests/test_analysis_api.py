"""HTTP behaviour of POST /v1/analyze: bounds, privacy and honest statuses."""

import json
import logging
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.analysis.body_limit import TOO_LARGE_DETAIL
from app.analysis.config import MAX_REQUEST_BODY_BYTES, ProviderConfig
from app.analysis.llm import request_findings
from app.analysis.service import PROVIDER_FAILED_LIMITATION
from app.main import app
from app.models import AnalysisResponse

ROOT = Path(__file__).resolve().parents[3]
client = TestClient(app)

SECRET_POLICY = "Мы не передаём данные третьим лицам. Контрольная строка SEKRET-POLICY-MARKER."
REQUEST = {
    "hostname": "shop.example.com",
    "policy_text": SECRET_POLICY,
    "evidence": [
        {
            "id": "r1",
            "kind": "resource_domain",
            "value": "metrics.tracker.net",
            "limitation": "Ограниченное наблюдение.",
        }
    ],
}


def test_analyze_returns_a_contract_valid_response():
    response = client.post("/v1/analyze", json=REQUEST)
    assert response.status_code == 200
    parsed = AnalysisResponse.model_validate(response.json())
    assert parsed.hostname == "shop.example.com"
    assert parsed.mode in {"rules", "llm"}
    assert parsed.findings and parsed.findings[0].policy_quote in SECRET_POLICY
    assert parsed.limitations


def test_shared_fixture_request_is_accepted():
    fixture = json.loads((ROOT / "contracts/fixtures/analysis-request.json").read_text())
    response = client.post("/v1/analyze", json=fixture)
    assert response.status_code == 200
    AnalysisResponse.model_validate(response.json())


@pytest.mark.parametrize(
    "payload",
    [
        {"hostname": "example.com", "policy_text": ""},
        {"hostname": "example.com", "policy_text": "x" * 20001},
        {"hostname": "https://example.com", "policy_text": "policy"},
        {"hostname": "example.com", "policy_text": "policy", "cookies": "session=secret"},
    ],
)
def test_invalid_requests_are_rejected_with_422(payload):
    assert client.post("/v1/analyze", json=payload).status_code == 422


def test_oversized_body_is_rejected_before_json_parsing():
    oversized = b'{"padding": "' + b"a" * (MAX_REQUEST_BODY_BYTES + 1024) + b'"}'
    response = client.post(
        "/v1/analyze",
        content=oversized,
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413
    assert response.json() == {"detail": TOO_LARGE_DETAIL}


def test_oversized_body_is_rejected_even_without_content_length():
    def chunks():
        yield b'{"padding": "'
        yield b"a" * (MAX_REQUEST_BODY_BYTES + 1024)
        yield b'"}'

    response = client.post(
        "/v1/analyze",
        content=chunks(),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 413


def test_other_endpoints_are_not_affected_by_the_analyze_body_limit():
    assert client.get("/health").status_code == 200


def test_policy_text_is_not_written_to_logs(caplog):
    with caplog.at_level(logging.DEBUG):
        assert client.post("/v1/analyze", json=REQUEST).status_code == 200
    assert "SEKRET-POLICY-MARKER" not in caplog.text


def test_response_never_claims_a_legal_verdict():
    body = client.post("/v1/analyze", json=REQUEST).json()
    text = json.dumps(body, ensure_ascii=False).lower()
    for forbidden in ("мошенничеств", "нарушает закон", "незаконн", "виновен"):
        assert forbidden not in text


@pytest.mark.parametrize("value", ["²", "③", "-1", "1.5", "not-a-number"])
def test_invalid_cookie_observation_is_unknown_not_a_server_error(value, monkeypatch):
    monkeypatch.delenv("LLM_API_KEY", raising=False)
    request = {
        "hostname": "example.com",
        "policy_text": "Мы используем cookie.",
        "evidence": [
            {
                "id": "c1",
                "kind": "visible_cookie_count",
                "value": value,
                "limitation": "Synthetic malformed observation.",
            }
        ],
    }
    response = client.post("/v1/analyze", json=request)
    assert response.status_code == 200
    parsed = AnalysisResponse.model_validate(response.json())
    assert parsed.status == "insufficient_data" and parsed.findings == []


def test_malformed_provider_ids_return_http_200_rules_fallback(monkeypatch):
    config = ProviderConfig(
        api_key="synthetic-test-key",
        base_url="https://provider.invalid",
        model="test",
        timeout_seconds=1,
    )
    monkeypatch.setattr("app.analysis.service.load_provider_config", lambda: config)
    content = json.dumps(
        {
            "findings": [
                {
                    "title": "Malformed",
                    "explanation": "Invalid IDs",
                    "severity": "warning",
                    "policy_quote": "не передаём данные третьим лицам",
                    "evidence_ids": None,
                }
            ]
        }
    )
    provider = httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200,
                json={"choices": [{"finish_reason": "stop", "message": {"content": content}}]},
            )
        )
    )
    monkeypatch.setattr(
        "app.analysis.service.request_findings",
        lambda *args, **kwargs: request_findings(*args, **(kwargs | {"client": provider})),
    )
    response = client.post("/v1/analyze", json=REQUEST)
    assert response.status_code == 200
    parsed = AnalysisResponse.model_validate(response.json())
    assert parsed.mode == "rules" and parsed.findings
    assert PROVIDER_FAILED_LIMITATION in parsed.limitations
