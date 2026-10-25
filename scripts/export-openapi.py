"""Run with the API installed: .venv/bin/python scripts/export-openapi.py."""

import json
from pathlib import Path

from app.main import app

output = Path(__file__).resolve().parents[1] / "contracts/openapi.json"
output.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n")
