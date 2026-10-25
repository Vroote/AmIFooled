"""Manual paid smoke: FastAPI in-process HTTP boundary + real DeepSeek (up to 3 calls).

Run from an installed API environment. Reads LLM_API_KEY or prompts without echo;
never writes credentials, policy bodies, or provider replies. Not part of CI.
"""

import getpass
import json
import os
import time
from datetime import UTC, datetime

from app.analysis.config import load_provider_config
from app.main import app
from app.models import AnalysisResponse
from fastapi.testclient import TestClient

CASES = [
    {
        "name": "policy_only_risk",
        "policy": (
            "Мы можем продавать сведения о ваших покупках рекламным партнёрам. "
            "Данные хранятся бессрочно, процедура удаления не предусмотрена."
        ),
        "evidence": [],
        "expect_findings": True,
    },
    {
        "name": "neutral_cookie_policy",
        "policy": (
            "Мы используем только необходимые cookies для сохранения выбранного языка. "
            "Данные не продаются и не передаются рекламным партнёрам. "
            "Cookies удаляются через 24 часа. Подписки и автоматические списания отсутствуют."
        ),
        "evidence": [
            {
                "id": "c1",
                "kind": "visible_cookie_count",
                "value": "2",
                "limitation": "JS-доступные cookies; назначение и согласие неизвестны.",
            }
        ],
        "expect_findings": False,
    },
    {
        "name": "cookie_denial_with_observation",
        "policy": "Мы не используем cookies.",
        "evidence": [
            {
                "id": "c1",
                "kind": "visible_cookie_count",
                "value": "2",
                "limitation": "HttpOnly и другие недоступные JS cookies не проверены.",
            }
        ],
        "expect_findings": True,
    },
]


def main() -> int:
    key = os.environ.get("LLM_API_KEY") or getpass.getpass("LLM_API_KEY (hidden): ")
    if not key.strip():
        print("No key supplied; no requests made.")
        return 1
    os.environ["LLM_API_KEY"] = key.strip()
    config = load_provider_config()
    if config is None or config.base_url not in {
        "https://api.deepseek.com",
        "https://api.deepseek.com/v1",
    }:
        print("Live smoke requires the official HTTPS DeepSeek API base.")
        return 1
    print(json.dumps({"checked_at": datetime.now(UTC).isoformat(), "model": config.model}))
    passed = True
    with TestClient(app) as client:
        for case in CASES:
            started = time.monotonic()
            reply = client.post(
                "/v1/analyze",
                json={
                    "hostname": "demo.example",
                    "policy_text": case["policy"],
                    "evidence": case["evidence"],
                },
            )
            elapsed = time.monotonic() - started
            response = AnalysisResponse.model_validate(reply.json())
            known = {item["id"] for item in case["evidence"]}
            grounded = all(
                item.policy_quote
                and item.policy_quote in case["policy"]
                and set(item.evidence_ids) <= known
                for item in response.findings
            )
            case_passed = (
                reply.status_code == 200
                and response.mode == "llm"
                and elapsed < 15
                and grounded
                and bool(response.findings) == case["expect_findings"]
            )
            # Only summaries of synthetic fixtures; do not print raw completions or inputs.
            print(
                json.dumps(
                    {
                        "case": case["name"],
                        "http_status": reply.status_code,
                        "latency_seconds": round(elapsed, 3),
                        "mode": response.mode,
                        "status": response.status,
                        "findings": len(response.findings),
                        "quotes_and_ids_valid": grounded,
                        "passed": case_passed,
                        "summary": response.summary,
                        "limitations": response.limitations,
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )
            passed = passed and case_passed
            if response.mode != "llm":
                break  # Do not repeat paid calls when the provider is unavailable/misconfigured.
    return 0 if passed else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        # Exception strings may contain request details; report only the class.
        print(f"Smoke failed: {type(exc).__name__}")
        raise SystemExit(1) from None
    finally:
        os.environ.pop("LLM_API_KEY", None)
