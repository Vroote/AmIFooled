"""Bounded HIBP adapter. All upstream data is untrusted; failures stay unknown."""

import asyncio
import json
import os
import time
from collections import OrderedDict
from collections.abc import Callable
from datetime import UTC, date, datetime
from email.utils import parsedate_to_datetime
from functools import lru_cache
from typing import Literal
from urllib.parse import quote

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.breaches.domains import normalize_domain
from app.models import Breach, BreachesResponse

HIBP_URL = "https://haveibeenpwned.com/api/v3/breaches"
ATTRIBUTION = "https://haveibeenpwned.com/"
TTL = 3600
MAX_KEYS = 256
MAX_BYTES = 2 * 1024 * 1024


class CatalogueRecord(BaseModel):
    model_config = ConfigDict(extra="ignore", strict=True)

    Name: str = Field(min_length=1, max_length=200)
    Title: str = Field(min_length=1, max_length=500)
    Domain: str = Field(min_length=1, max_length=254)
    BreachDate: str
    DataClasses: list[str] = Field(max_length=200)
    IsVerified: bool


def retry_delay(value: str | None, now: datetime) -> float:
    """Accept delta-seconds or HTTP dates; malformed headers back off for a minute."""
    if value is None:
        return 60
    if value.isascii() and value.isdigit() and len(value) <= 12:
        return max(1, int(value))
    try:
        until = parsedate_to_datetime(value)
        if until.tzinfo is None:
            return 60
        return max(1, (until - now).total_seconds())
    except (TypeError, ValueError, OverflowError):
        return 60


class BreachService:
    def __init__(
        self,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        now: Callable[[], datetime] = lambda: datetime.now(UTC),
        mode: Literal["hibp", "fixture"] = "hibp",
    ):
        if mode not in ("hibp", "fixture"):
            raise ValueError("AMIFOOLED_BREACHES_MODE must be hibp or fixture")
        self.transport = transport
        self.clock = clock
        self.now = now
        self.mode = mode
        self.cache: OrderedDict[str, tuple[float, BreachesResponse]] = OrderedDict()
        self.retry_at = 0.0

    def response(
        self, hostname: str, domain: str, breaches: list[Breach] | None
    ) -> BreachesResponse:
        return BreachesResponse(
            hostname=hostname,
            matched_domain=domain,
            status="unavailable" if breaches is None else ("ok" if breaches else "not_found"),
            count=None if breaches is None else len(breaches),
            breaches=breaches or [],
            checked_at=self.now(),
            source=self.mode,
            attribution_url=ATTRIBUTION,
        )

    async def lookup(self, value: str) -> BreachesResponse:
        hostname, domain = normalize_domain(value)
        if self.mode == "fixture":
            # Synthetic data is never silently substituted on upstream failure.
            records = None
            if domain == "example.com":
                records = [
                    Breach(
                        name="SyntheticExample",
                        title="Synthetic example — not a real incident",
                        breach_date=date(2020, 1, 1),
                        data_classes=["Email addresses"],
                        is_verified=False,
                        source_url=ATTRIBUTION,
                    )
                ]
            return self.response(hostname, domain, records)

        cached = self.cache.get(domain)
        if cached is not None:
            expires, result = cached
            if self.clock() < expires:
                self.cache.move_to_end(domain)
                return result.model_copy(deep=True, update={"hostname": hostname})
            del self.cache[domain]
        if self.clock() < self.retry_at:
            return self.response(hostname, domain, None)
        try:
            # Both HTTPX phase timeouts and a total wall-clock deadline, no retries.
            async with (
                asyncio.timeout(5),
                httpx.AsyncClient(
                    transport=self.transport,
                    timeout=5,
                    follow_redirects=False,
                    trust_env=False,
                    headers={"User-Agent": "AmIFooled/0.1", "Accept": "application/json"},
                ) as client,
            ):
                async with client.stream("GET", HIBP_URL, params={"Domain": domain}) as upstream:
                    if upstream.status_code == 429:
                        self.retry_at = max(
                            self.retry_at,
                            self.clock()
                            + retry_delay(upstream.headers.get("Retry-After"), self.now()),
                        )
                        return self.response(hostname, domain, None)
                    if upstream.status_code != 200:
                        return self.response(hostname, domain, None)
                    body = bytearray()
                    async for chunk in upstream.aiter_bytes(chunk_size=65536):
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            return self.response(hostname, domain, None)
                    payload = json.loads(body)
                    if not isinstance(payload, list) or len(payload) > 2000:
                        return self.response(hostname, domain, None)
                    records = self.parse_records(payload, domain)
        except (httpx.HTTPError, TimeoutError, ValueError, ValidationError, RecursionError):
            return self.response(hostname, domain, None)
        result = self.response(hostname, domain, records)
        self.cache[domain] = (self.clock() + TTL, result.model_copy(deep=True))
        self.cache.move_to_end(domain)
        while len(self.cache) > MAX_KEYS:
            self.cache.popitem(last=False)
        return result

    @staticmethod
    def parse_records(payload: list, domain: str) -> list[Breach]:
        breaches = []
        seen = set()
        for item in payload:
            record = CatalogueRecord.model_validate(item)
            record_hostname, _ = normalize_domain(record.Domain)
            # Do not trust the upstream filter, or equate a tenant with its host.
            if record_hostname != domain:
                raise ValueError("Unexpected upstream domain")
            if record.Name in seen:
                continue
            seen.add(record.Name)
            breaches.append(
                Breach(
                    name=record.Name,
                    title=record.Title,
                    breach_date=date.fromisoformat(record.BreachDate),
                    data_classes=record.DataClasses,
                    is_verified=record.IsVerified,
                    source_url=f"{ATTRIBUTION}PwnedWebsites#{quote(record.Name, safe='')}",
                )
            )
        return breaches


@lru_cache(maxsize=1)
def get_breach_service() -> BreachService:
    return BreachService(mode=os.getenv("AMIFOOLED_BREACHES_MODE", "hibp"))
