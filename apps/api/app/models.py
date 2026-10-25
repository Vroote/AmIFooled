"""Shared v1 boundary; OpenAPI and TypeScript are generated from these models."""

from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

Hostname = Annotated[
    str,
    Field(min_length=1, max_length=253, pattern=r"^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$"),
]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Evidence(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    kind: Literal["resource_domain", "visible_cookie_count", "policy_excerpt"]
    value: str = Field(max_length=500)
    # A bounded observation, not proof of tracking, disclosure, or legal violation.
    limitation: str = Field(max_length=500)


class AnalysisRequest(StrictModel):
    hostname: Hostname
    policy_text: str = Field(min_length=1, max_length=20000)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)


class Finding(StrictModel):
    title: str
    explanation: str
    severity: Literal["info", "warning"]
    policy_quote: str
    evidence_ids: list[str]


class AnalysisResponse(StrictModel):
    hostname: Hostname
    status: Literal["ok", "insufficient_data", "unavailable"]
    mode: Literal["rules", "llm", "fixture"]
    summary: str
    findings: list[Finding]
    limitations: list[str]


class Breach(StrictModel):
    name: str
    title: str
    breach_date: date
    data_classes: list[str]
    is_verified: bool
    source_url: str


class BreachesResponse(StrictModel):
    hostname: Hostname
    matched_domain: str | None
    status: Literal["ok", "not_found", "unavailable"]
    count: int | None = Field(ge=0)
    breaches: list[Breach]
    checked_at: datetime
    source: Literal["hibp", "fixture"]
    stale: bool = False
    attribution_url: str = "https://haveibeenpwned.com/"


class HealthResponse(StrictModel):
    status: Literal["ok"] = "ok"


class ErrorResponse(StrictModel):
    detail: str
