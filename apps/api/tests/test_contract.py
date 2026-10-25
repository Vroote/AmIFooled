import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import AnalysisRequest, AnalysisResponse, BreachesResponse

ROOT = Path(__file__).resolve().parents[3]
client = TestClient(app)


def test_health_and_openapi_are_available_without_external_services():
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/openapi.json").status_code == 200


def test_analyze_is_implemented_and_breaches_is_still_a_scaffold():
    request = json.loads((ROOT / "contracts/fixtures/analysis-request.json").read_text())
    analysis = client.post("/v1/analyze", json=request)
    assert analysis.status_code == 200
    AnalysisResponse.model_validate(analysis.json())
    assert client.get("/v1/breaches", params={"hostname": "example.com"}).status_code == 501


@pytest.mark.parametrize("hostname", ["https://example.com/path?secret=1", "a@example.com"])
def test_api_rejects_urls_and_email_addresses(hostname):
    assert client.get("/v1/breaches", params={"hostname": hostname}).status_code == 422


def test_request_bounds_and_forbidden_fields():
    with pytest.raises(ValidationError):
        AnalysisRequest(hostname="example.com", policy_text="x" * 20001)
    with pytest.raises(ValidationError):
        AnalysisRequest(hostname="example.com", policy_text="policy", cookies="session=secret")


@pytest.mark.parametrize(
    ("file", "model"),
    [
        ("analysis-request", AnalysisRequest),
        ("analysis-response", AnalysisResponse),
        ("breaches-response", BreachesResponse),
    ],
)
def test_shared_fixtures_follow_the_api_contract(file, model):
    model.model_validate_json((ROOT / f"contracts/fixtures/{file}.json").read_text())
