"""Idempotent initial issue publication. Only edits issues carrying our task marker."""

import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = "Vroote/AmIFooled"
MILESTONE = "Hackathon · 6h MVP"


def gh(*args, payload=None):
    command = ["gh", *args]
    if payload is not None:
        command += ["--input", "-"]
    result = subprocess.run(
        command,
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        check=True,
    )
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--publish", action="store_true")
    args = parser.parse_args()
    tasks = json.loads((ROOT / "scripts/tasks.json").read_text())
    if not args.publish:
        for task in tasks:
            print(task["key"], task["title"])
        return
    labels = {
        "hackathon": ("6F42C1", "Six-hour AmIFooled MVP"),
        "priority:p0": ("B60205", "Required for MVP or its delivery process"),
        "priority:stretch": ("C5DEF5", "Only after core acceptance"),
        "kind:feature": ("1D76DB", "Bounded feature task"),
        "kind:setup": ("5319E7", "Infrastructure and process"),
        "area:platform": ("BFD4F2", "CI, workflow, repository"),
        "area:extension": ("BFDADC", "WXT / React / MV3"),
        "area:backend": ("D4C5F9", "FastAPI and external providers"),
        "area:integration": ("F9D0C4", "Integration, acceptance, demo"),
        "status:ready": ("0E8A16", "Dependencies merged; available to claim"),
        "status:blocked": (
            "D93F0B",
            "Waiting for a named dependency or external access",
        ),
        "status:in-progress": ("1D76DB", "Claimed by an agent"),
        "status:review": ("FBCA04", "PR ready for independent review"),
    }
    existing_labels = {x["name"] for x in gh("api", f"repos/{REPO}/labels?per_page=100")}
    for name, (color, description) in labels.items():
        if name not in existing_labels:
            gh(
                "api",
                f"repos/{REPO}/labels",
                payload={"name": name, "color": color, "description": description},
            )
    milestones = gh("api", f"repos/{REPO}/milestones?state=all&per_page=100")
    milestone = next((x for x in milestones if x["title"] == MILESTONE), None)
    if milestone is None:
        milestone = gh(
            "api",
            f"repos/{REPO}/milestones",
            payload={
                "title": MILESTONE,
                "description": "4 implementation lanes + rotating review. Core first; archive after acceptance. Relative six-hour schedule, no invented due date.",
            },
        )
    existing = gh(
        "issue",
        "list",
        "-R",
        REPO,
        "--state",
        "all",
        "--limit",
        "1000",
        "--json",
        "number,body,url",
    )
    mapping = {}
    for task in tasks:
        marker = f"<!-- amifooled-task:{task['key']} -->"
        issue = next((x for x in existing if marker in x["body"]), None)
        if issue is None:
            issue = gh(
                "api",
                f"repos/{REPO}/issues",
                payload={
                    "title": task["title"],
                    "body": marker + "\n\nПодготавливается описание и связи задач.",
                    "milestone": milestone["number"],
                    "labels": [
                        "hackathon",
                        "priority:" + task["priority"].lower(),
                        "area:" + task["area"],
                        "kind:setup" if task["key"] in ("setup", "admin") else "kind:feature",
                        "status:in-progress" if task["key"] == "setup" else "status:blocked",
                    ],
                },
            )
        mapping[task["key"]] = {
            "number": issue["number"],
            "url": issue.get("html_url", issue.get("url")),
        }
        print(task["key"], mapping[task["key"]]["url"], flush=True)
    (ROOT / "docs").mkdir(exist_ok=True)
    (ROOT / "docs/issues.json").write_text(json.dumps(mapping, ensure_ascii=False, indent=2) + "\n")
    for task in tasks:
        deps = ", ".join(f"#{mapping[key]['number']}" for key in task["depends"]) or "нет"
        criteria = "\n".join("- [ ] " + item for item in task["criteria"])
        body = f"""<!-- amifooled-task:{task["key"]} -->
## Результат

{task["scope"]}

## План и границы

- Приоритет: **{task["priority"]}**; поток: **{task["lane"]}**; оценка: **{task["estimate"]} мин** активной работы.
- Зависит от: {deps}. Начинать код после merge зависимостей; fixtures/чеклист допустимо готовить раньше.
- Владение файлами: {task["files"]}.
- [Project](https://github.com/users/Vroote/projects/1/views/1). Общий план: `docs/HACKATHON.md`, процесс: `AGENTS.md` (в setup PR до его merge).

## Acceptance criteria

{criteria}

## Проверка

{task["checks"]}

## Передача

{task["handoff"]}

Взятие задачи: comment `CLAIM agent=<id> branch=issue/<number>-<slug> ETA=<мин>` + assignee + `status:in-progress`. Один владелец; если есть CLAIM — сначала согласовать. GitHub comments/mentions — общий журнал. PR: `Closes #{mapping[task["key"]]["number"]}`; один approve от другого GitHub identity с Write, зелёный `ci`, затем squash merge. Новые commits требуют повторной проверки.
"""
        gh(
            "api",
            f"repos/{REPO}/issues/{mapping[task['key']]['number']}",
            "--method",
            "PATCH",
            payload={"body": body},
        )


if __name__ == "__main__":
    main()
