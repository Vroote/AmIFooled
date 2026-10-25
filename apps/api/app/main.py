from fastapi import FastAPI, HTTPException

from app.analysis import (
    MAX_REQUEST_BODY_BYTES,
    BodySizeLimitMiddleware,
    analyze_policy,
)
from app.models import (
    AnalysisRequest,
    AnalysisResponse,
    BreachesResponse,
    ErrorResponse,
    HealthResponse,
    Hostname,
)

app = FastAPI(title="AmIFooled API", version="0.1.0")

# Scoped to the analyze path: the body is bounded before FastAPI parses JSON.
app.add_middleware(
    BodySizeLimitMiddleware,
    max_bytes=MAX_REQUEST_BODY_BYTES,
    paths=("/v1/analyze",),
)


@app.get("/health", response_model=HealthResponse, operation_id="health")
def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/v1/analyze",
    response_model=AnalysisResponse,
    responses={413: {"model": ErrorResponse}},
    operation_id="analyze",
)
def analyze(request: AnalysisRequest) -> AnalysisResponse:
    # Always answers: an unusable provider degrades to rules and is reported in limitations.
    return analyze_policy(request)


@app.get(
    "/v1/breaches",
    response_model=BreachesResponse,
    responses={501: {"model": ErrorResponse}},
    operation_id="breaches",
)
def breaches(hostname: Hostname) -> BreachesResponse:
    raise HTTPException(status_code=501, detail="Breach provider is not implemented yet")
