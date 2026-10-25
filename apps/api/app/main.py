from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Query

from app.analysis import (
    MAX_REQUEST_BODY_BYTES,
    BodySizeLimitMiddleware,
    analyze_policy,
)
from app.breaches.service import BreachService, get_breach_service
from app.models import (
    AnalysisRequest,
    AnalysisResponse,
    BreachesResponse,
    ErrorResponse,
    HealthResponse,
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
    operation_id="breaches",
)
async def breaches(
    hostname: Annotated[str, Query(min_length=1, max_length=254)],
    service: Annotated[BreachService, Depends(get_breach_service)],
) -> BreachesResponse:
    try:
        return await service.lookup(hostname)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail="Expected a public DNS hostname") from exc
