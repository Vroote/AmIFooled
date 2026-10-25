import asyncio
from datetime import UTC, datetime, timedelta
from email.utils import format_datetime

import httpx
import pytest
from fastapi.testclient import TestClient

from app.breaches.domains import normalize_domain
from app.breaches.service import (
    ATTRIBUTION,
    MAX_BYTES,
    MAX_KEYS,
    TTL,
    BreachService,
    get_breach_service,
    retry_delay,
)
from app.main import app

NOW = datetime(2026, 10, 25, tzinfo=UTC)


def record(domain="example.com", name="Example"):
    return {
        "Name": name,
        "Title": "Example incident",
        "Domain": domain,
        "BreachDate": "2020-01-02",
        "DataClasses": ["Email addresses"],
        "IsVerified": True,
        "Description": '<script>alert("never returned")</script>',
    }


@pytest.fixture(autouse=True)
def forbid_live_http(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError("CI tests must not use external HTTP")

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", forbidden)


def run(service, hostname="example.com"):
    return asyncio.run(service.lookup(hostname))


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("WWW.Example.COM.", ("www.example.com", "example.com")),
        ("shop.example.co.uk", ("shop.example.co.uk", "example.co.uk")),
        ("alice.github.io", ("alice.github.io", "alice.github.io")),
        ("www.alice.github.io", ("www.alice.github.io", "alice.github.io")),
        ("bob.blogspot.com", ("bob.blogspot.com", "bob.blogspot.com")),
        ("пример.рф", ("xn--e1afmkfd.xn--p1ai", "xn--e1afmkfd.xn--p1ai")),
        ("www。example.com。", ("www.example.com", "example.com")),
        ("github.io", ("github.io", "github.io")),
    ],
)
def test_offline_psl_idna(value, expected):
    assert normalize_domain(value) == expected


@pytest.mark.parametrize(
    "value",
    [
        "",
        "example.com..",
        "https://example.com",
        "example.com/path",
        "a@example.com",
        "example.com:443",
        " example.com",
        "example.com ",
        "foo_bar.com",
        "-a.com",
        "a-.com",
        "a..com",
        "127.0.0.1",
        "127.1",
        "::1",
        "[::1]",
        "localhost",
        "com",
        "co.uk",
        "invalid.unknownsuffix",
        "a" * 64 + ".com",
        "xn--.com",
        "example.com?x=1",
    ],
)
def test_invalid_hostname(value):
    with pytest.raises(ValueError):
        normalize_domain(value)


def test_verified_records_fixed_url_headers_and_attribution():
    def handler(request):
        assert str(request.url.copy_with(query=None)) == (
            "https://haveibeenpwned.com/api/v3/breaches"
        )
        assert dict(request.url.params) == {"Domain": "example.com"}
        assert request.headers["User-Agent"] == "AmIFooled/0.1"
        assert "hibp-api-key" not in request.headers
        assert all(t <= 5 for t in request.extensions["timeout"].values())
        return httpx.Response(200, json=[record(), record(), record(name="Example2")])

    result = run(BreachService(transport=httpx.MockTransport(handler), now=lambda: NOW))
    assert result.status == "ok" and result.count == 2
    assert result.checked_at == NOW and result.source == "hibp" and not result.stale
    assert result.attribution_url == ATTRIBUTION
    assert result.breaches[0].breach_date.isoformat() == "2020-01-02"
    assert result.breaches[0].is_verified is True
    assert result.breaches[0].data_classes == ["Email addresses"]
    assert result.breaches[0].source_url == ATTRIBUTION + "PwnedWebsites#Example"
    assert "Description" not in result.model_dump_json()


def test_empty_list_is_not_found():
    result = run(
        BreachService(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[])))
    )
    assert result.status == "not_found" and result.count == 0 and result.breaches == []


@pytest.mark.parametrize("status", [301, 302, 400, 401, 403, 404, 429, 500, 503])
def test_http_failures_are_unknown_without_redirects_or_retries(status):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(status, headers={"Location": "http://127.0.0.1/private"})

    service = BreachService(transport=httpx.MockTransport(handler))
    result = run(service)
    assert result.status == "unavailable" and result.count is None and result.breaches == []
    assert len(calls) == 1 and not service.cache


@pytest.mark.parametrize(
    "error", [httpx.ReadTimeout, httpx.ConnectError, httpx.RemoteProtocolError]
)
def test_transport_errors_are_unknown(error):
    def handler(request):
        raise error("upstream failed", request=request)

    result = run(BreachService(transport=httpx.MockTransport(handler)))
    assert result.status == "unavailable" and result.count is None


def test_total_deadline(monkeypatch):
    original = asyncio.timeout
    monkeypatch.setattr("app.breaches.service.asyncio.timeout", lambda _: original(0.01))

    async def handler(request):
        await asyncio.sleep(1)
        return httpx.Response(200, json=[])

    result = run(BreachService(transport=httpx.MockTransport(handler)))
    assert result.status == "unavailable" and result.count is None


@pytest.mark.parametrize(
    "payload",
    [
        {},
        [None],
        [record(domain="elsewhere.com")],
        [record(domain="other.example.com")],
        [{**record(), "BreachDate": "invalid"}],
        [{**record(), "IsVerified": "true"}],
        [{**record(), "DataClasses": [42]}],
        [{**record(), "Name": ""}],
    ],
)
def test_invalid_catalogue_never_becomes_zero(payload):
    result = run(
        BreachService(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=payload)))
    )
    assert result.status == "unavailable" and result.count is None


@pytest.mark.parametrize(
    "body", [b"not json", b"\xff", b"x" * (MAX_BYTES + 1), b"[" * 1500 + b"]" * 1500]
)
def test_invalid_or_oversized_body(body):
    result = run(
        BreachService(transport=httpx.MockTransport(lambda _: httpx.Response(200, content=body)))
    )
    assert result.status == "unavailable" and result.count is None


def test_tenant_does_not_inherit_platform_breaches():
    calls = []

    def handler(request):
        calls.append(request.url.params["Domain"])
        return httpx.Response(200, json=[record(domain="github.io")])

    result = run(BreachService(transport=httpx.MockTransport(handler)), "alice.github.io")
    assert calls == ["alice.github.io"]
    assert result.matched_domain == "alice.github.io" and result.count is None


def test_cache_ttl_original_timestamp_and_response_isolation():
    clock = [0.0]
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[record()])

    service = BreachService(
        transport=httpx.MockTransport(handler), clock=lambda: clock[0], now=lambda: NOW
    )
    first = run(service, "www.example.com")
    first.breaches.clear()
    clock[0] = TTL - 1
    second = run(service, "shop.example.com")
    assert len(calls) == 1 and second.count == 1 and len(second.breaches) == 1
    assert second.hostname == "shop.example.com" and second.matched_domain == "example.com"
    assert second.checked_at == NOW
    clock[0] = TTL
    run(service)
    assert len(calls) == 2


def test_cache_lru_bound():
    service = BreachService(transport=httpx.MockTransport(lambda _: httpx.Response(200, json=[])))
    for i in range(MAX_KEYS):
        run(service, f"site{i}.com")
    run(service, "site0.com")
    run(service, "newsite.com")
    assert len(service.cache) == MAX_KEYS and "site0.com" in service.cache
    assert "site1.com" not in service.cache


def test_empty_results_are_cached_but_failure_after_expiry_is_not_zero():
    clock = [0.0]
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[]) if len(calls) == 1 else httpx.Response(503)

    service = BreachService(transport=httpx.MockTransport(handler), clock=lambda: clock[0])
    assert run(service).status == "not_found"
    assert run(service).status == "not_found" and len(calls) == 1
    clock[0] = TTL
    result = run(service)
    assert result.status == "unavailable" and result.count is None and not service.cache


def test_failure_is_not_cached_and_upstream_recovers():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(503) if len(calls) == 1 else httpx.Response(200, json=[])

    service = BreachService(transport=httpx.MockTransport(handler))
    assert run(service).status == "unavailable"
    assert run(service).status == "not_found" and len(calls) == 2


@pytest.mark.parametrize(
    "header", ["120", format_datetime(NOW + timedelta(seconds=120), usegmt=True)]
)
def test_retry_after_blocks_all_domains_without_sleeping(header):
    clock = [0.0]
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(429, headers={"Retry-After": header})

    service = BreachService(
        transport=httpx.MockTransport(handler), clock=lambda: clock[0], now=lambda: NOW
    )
    run(service)
    clock[0] = 119
    assert run(service, "example.net").count is None and len(calls) == 1
    clock[0] = 120
    run(service)
    assert len(calls) == 2


@pytest.mark.parametrize("header", [None, "invalid", "NaN", "-1", "9" * 100])
def test_bad_retry_after_uses_safe_default(header):
    assert retry_delay(header, NOW) == 60


def test_fixture_mode_explicit_and_offline():
    fixture = BreachService(mode="fixture")
    assert run(fixture).source == "fixture" and run(fixture).count == 1
    assert run(fixture, "adobe.com").status == "unavailable"
    assert run(fixture, "adobe.com").source == "fixture"
    with pytest.raises(ValueError):
        BreachService(mode="typo")


def test_endpoint_normalizes_and_validates_without_changing_analyzer():
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json=[])

    service = BreachService(transport=httpx.MockTransport(handler))
    app.dependency_overrides[get_breach_service] = lambda: service
    try:
        with TestClient(app) as client:
            result = client.get("/v1/breaches", params={"hostname": "ПРИМЕР.РФ."})
            assert result.status_code == 200
            assert result.json()["hostname"] == "xn--e1afmkfd.xn--p1ai"
            for value in ["https://example.com", "127.0.0.1", "a@example.com", "a..com"]:
                assert client.get("/v1/breaches", params={"hostname": value}).status_code == 422
            assert client.get("/v1/breaches").status_code == 422
            assert len(calls) == 1
            assert client.get("/health").json() == {"status": "ok"}
    finally:
        app.dependency_overrides.pop(get_breach_service, None)
