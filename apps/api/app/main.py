from fastapi import FastAPI, HTTPException

from app.models import (
    AnalysisRequest,
    AnalysisResponse,
    BreachesResponse,
    ErrorResponse,
    HealthResponse,
    Hostname,
)

app = FastAPI(title="AmIFooled API", version="0.1.0")


@app.get("/health", response_model=HealthResponse, operation_id="health")
def health() -> HealthResponse:
    return HealthResponse()


@app.post(
    "/v1/analyze",
    response_model=AnalysisResponse,
    responses={501: {"model": ErrorResponse}},
    operation_id="analyze",
)
def analyze(request: AnalysisRequest) -> AnalysisResponse:
    # Deliberately explicit: the setup must never masquerade as a working analyzer.
    raise HTTPException(status_code=501, detail="Analysis provider is not implemented yet")


@app.get(
    "/v1/breaches",
    response_model=BreachesResponse,
    responses={501: {"model": ErrorResponse}},
    operation_id="breaches",
)
def breaches(hostname: Hostname) -> BreachesResponse:
    raise HTTPException(status_code=501, detail="Breach provider is not implemented yet")
