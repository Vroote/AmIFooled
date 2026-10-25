"""Build and HTTP-test the actual containers; no keys or external API calls.

Uses an isolated Compose project, a dynamically assigned loopback port, and temporary
extension output. Only this script's containers are removed, including after failure.
"""

import argparse
import json
import os
import subprocess
import tempfile
import urllib.request
import uuid
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def check_artifact(output: Path) -> None:
    unpacked = output / "chrome-mv3"
    manifest = json.loads((unpacked / "manifest.json").read_text())
    assert manifest["manifest_version"] == 3
    assert manifest["name"] == "AmIFooled"
    assert (unpacked / manifest["action"]["default_popup"]).is_file()
    files = {
        str(p.relative_to(unpacked)).replace(os.sep, "/")
        for p in unpacked.rglob("*")
        if p.is_file()
    }
    with zipfile.ZipFile(output / "amifooled-chrome.zip") as archive:
        assert archive.testzip() is None
        assert set(archive.namelist()) == files, "ZIP and unpacked extension differ"
        for name in files:
            assert not any(p.startswith(".env") or p == "node_modules" for p in Path(name).parts), (
                name
            )
            assert archive.read(name) == (unpacked / name).read_bytes(), name
    print("PASS: MV3 manifest, popup and identical ZIP/unpacked files", flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--extension-output", type=Path, help="Keep exported files here (e.g. dist)"
    )
    args = parser.parse_args()
    env = {
        **os.environ,
        "AMIFOOLED_API_PORT": "0",
        "AMIFOOLED_BREACHES_MODE": "fixture",
        "LLM_API_KEY": "",
        "LLM_BASE_URL": "https://api.deepseek.com",
        "LLM_MODEL": "deepseek-flash",
        "LLM_TIMEOUT_SECONDS": "12",
    }
    with tempfile.TemporaryDirectory(prefix="amifooled-docker-") as temp:
        output = (
            args.extension_output.resolve() if args.extension_output else Path(temp) / "extension"
        )
        empty_env = Path(temp) / "empty.env"
        empty_env.touch()
        compose = [
            "docker",
            "compose",
            "--env-file",
            str(empty_env),
            "--project-name",
            f"amifooled-smoke-{uuid.uuid4().hex[:12]}",
            "--file",
            str(ROOT / "compose.yaml"),
        ]

        def run(*args: str, capture: bool = False) -> str:
            result = subprocess.run(
                [*compose, *args], cwd=ROOT, env=env, check=True, text=True, capture_output=capture
            )
            return result.stdout if capture else ""

        try:
            run("up", "--build", "--detach", "--wait", "--wait-timeout", "120")
            address = run("port", "api", "8000", capture=True).strip()
            assert address.startswith("127.0.0.1:"), address
            base = f"http://{address}"
            # Local smoke must not be redirected via a machine's HTTP proxy.
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

            def request(path: str, body: dict | None = None) -> dict:
                data = None if body is None else json.dumps(body).encode()
                req = urllib.request.Request(
                    base + path, data=data, headers={"Content-Type": "application/json"}
                )
                with opener.open(req, timeout=20) as response:
                    assert response.status == 200
                    return json.load(response)

            assert request("/health") == {"status": "ok"}
            policy = "Мы не используем cookie. DockerSmokePrivateMarker."
            analysis = request(
                "/v1/analyze",
                {
                    "hostname": "example.com",
                    "policy_text": policy,
                    "evidence": [
                        {
                            "id": "c1",
                            "kind": "visible_cookie_count",
                            "value": "2",
                            "limitation": "Only JavaScript-visible cookies.",
                        }
                    ],
                },
            )
            assert analysis["mode"] == "rules" and analysis["status"] == "ok"
            assert any(
                f["policy_quote"] and f["policy_quote"] in policy and f["evidence_ids"] == ["c1"]
                for f in analysis["findings"]
            )
            breaches = request("/v1/breaches?hostname=www.example.com")
            assert breaches["source"] == "fixture" and breaches["count"] == 1
            assert breaches["matched_domain"] == "example.com"
            unknown = request("/v1/breaches?hostname=example.org")
            assert unknown["status"] == "unavailable" and unknown["count"] is None
            run(
                "exec",
                "-T",
                "api",
                "python",
                "-c",
                "import os, importlib.util; assert os.getuid() != 0; "
                "assert not os.getenv('LLM_API_KEY'); "
                "assert importlib.util.find_spec('pytest') is None; "
                "assert importlib.util.find_spec('ruff') is None",
            )
            assert "DockerSmokePrivateMarker" not in run("logs", "--no-color", capture=True)
            print(
                "PASS: health, rules/quotes, fixture/unknown breaches, non-root, no body logs",
                flush=True,
            )
            subprocess.run(
                [
                    "docker",
                    "build",
                    "--file",
                    "apps/extension/Dockerfile",
                    "--target",
                    "export",
                    "--build-arg",
                    "WXT_API_BASE_URL=http://127.0.0.1:8000",
                    "--output",
                    f"type=local,dest={output}",
                    ".",
                ],
                cwd=ROOT,
                env=env,
                check=True,
            )
            check_artifact(output)
        finally:
            run("down", "--remove-orphans")


if __name__ == "__main__":
    main()
