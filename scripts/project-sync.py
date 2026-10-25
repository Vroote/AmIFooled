"""Reconcile this repository's issues/PRs into the existing Project, without secrets on disk.

Local: gh auth refresh -s project, then python3 scripts/project-sync.py.
Actions: use PROJECT_TOKEN via GH_TOKEN. Never run PR-provided code with that token.
"""

import argparse
import json
import subprocess
from pathlib import Path

REPO = "Vroote/AmIFooled"
OWNER = "Vroote"
NUMBER = "1"


def gh(*args, payload=None):
    result = subprocess.run(
        ["gh", *args, *(["--input", "-"] if payload is not None else [])],
        input=json.dumps(payload) if payload is not None else None,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode:
        raise RuntimeError(result.stderr.strip())
    return json.loads(result.stdout) if result.stdout.strip() else None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--init-fields", action="store_true", help="Add our planning fields if missing"
    )
    args = parser.parse_args()
    project = gh("project", "view", NUMBER, "--owner", OWNER, "--format", "json")
    fields = {
        f["name"]: f
        for f in gh("project", "field-list", NUMBER, "--owner", OWNER, "--format", "json")["fields"]
    }
    if args.init_fields:
        for name, kind in [
            ("Priority", "SINGLE_SELECT"),
            ("Estimate (min)", "NUMBER"),
            ("Lane", "TEXT"),
            ("Depends on", "TEXT"),
        ]:
            if name not in fields:
                command = [
                    "project",
                    "field-create",
                    NUMBER,
                    "--owner",
                    OWNER,
                    "--name",
                    name,
                    "--data-type",
                    kind,
                    "--format",
                    "json",
                ]
                if kind == "SINGLE_SELECT":
                    command += ["--single-select-options", "P0,P1,Stretch"]
                fields[name] = gh(*command)
    # Paginate repository content. Project addItem is idempotent for existing content.
    issues = gh("api", "--paginate", "--slurp", f"repos/{REPO}/issues?state=all&per_page=100")
    pulls = gh("api", "--paginate", "--slurp", f"repos/{REPO}/pulls?state=all&per_page=100")
    root = Path(__file__).resolve().parents[1]
    tasks = json.loads((root / "scripts/tasks.json").read_text())
    mapping = json.loads((root / "docs/issues.json").read_text())
    plans = {mapping[t["key"]]["number"]: t for t in tasks}
    statuses = {x["name"]: x["id"] for x in fields["Status"]["options"]}
    repo_issues = [x for page in issues for x in page if "pull_request" not in x]
    states = {x["number"]: x["state"] for x in repo_issues}
    # On reopen, clear old workflow labels only if nothing is actively claimed/reviewed.
    for item in repo_issues + [x for page in pulls for x in page]:
        is_pr = "head" in item
        labels = {x["name"] for x in item.get("labels", [])}
        task = plans.get(item["number"]) if not is_pr else None
        if (
            task
            and item["state"] == "open"
            and not labels.intersection({"status:in-progress", "status:review"})
        ):
            ready = all(states.get(mapping[d]["number"]) == "closed" for d in task["depends"])
            # Admin and stretch require an explicit owner's decision, even if dependencies close.
            ready = ready and task["key"] not in ("admin", "archive")
            desired = "status:ready" if ready else "status:blocked"
            current = labels.intersection({"status:ready", "status:blocked"})
            if current != {desired}:
                # Only remove workflow labels we own; preserve unrelated labels.
                for old in current - {desired}:
                    gh(
                        "api",
                        f"repos/{REPO}/issues/{item['number']}/labels/{old}",
                        "--method",
                        "DELETE",
                    )
                gh(
                    "api",
                    f"repos/{REPO}/issues/{item['number']}/labels",
                    payload={"labels": [desired]},
                )
                labels = (labels - current) | {desired}
        status = "Todo"
        if item["state"] == "closed" and (not is_pr or item.get("merged_at")):
            status = "Done"
        elif (is_pr and item["state"] == "open") or labels.intersection(
            {"status:in-progress", "status:review"}
        ):
            status = "In Progress"
        if is_pr and item["state"] == "closed" and not item.get("merged_at"):
            status = "Todo"  # A discarded PR is never completed work.
        result = gh(
            "api",
            "graphql",
            payload={
                "query": (
                    "mutation($p:ID!,$c:ID!){addProjectV2ItemById("
                    "input:{projectId:$p,contentId:$c}){item{id}}}"
                ),
                "variables": {"p": project["id"], "c": item["node_id"]},
            },
        )
        item_id = result["data"]["addProjectV2ItemById"]["item"]["id"]
        values = [(fields["Status"]["id"], {"singleSelectOptionId": statuses[status]})]
        if task:
            for name, value in [
                ("Estimate (min)", {"number": task["estimate"]}),
                ("Lane", {"text": task["lane"]}),
                (
                    "Depends on",
                    {"text": ", ".join(f"#{mapping[d]['number']}" for d in task["depends"]) or "—"},
                ),
            ]:
                if name in fields:
                    values.append((fields[name]["id"], value))
            if "Priority" in fields:
                option = next(
                    x["id"] for x in fields["Priority"]["options"] if x["name"] == task["priority"]
                )
                values.append((fields["Priority"]["id"], {"singleSelectOptionId": option}))
        for field_id, value in values:
            # Values encoded as GraphQL variables, not concatenated untrusted content.
            query = (
                "mutation($i:UpdateProjectV2ItemFieldValueInput!){"
                "updateProjectV2ItemFieldValue(input:$i){projectV2Item{id}}}"
            )
            gh(
                "api",
                "graphql",
                payload={
                    "query": query,
                    "variables": {
                        "i": {
                            "projectId": project["id"],
                            "itemId": item_id,
                            "fieldId": field_id,
                            "value": value,
                        }
                    },
                },
            )
        print(f"{'PR' if is_pr else 'Issue'} #{item['number']}: {status}", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, KeyError, StopIteration) as exc:
        raise SystemExit(
            f"Project sync failed: {exc}. Check gh project scope and Project Write access."
        ) from exc
