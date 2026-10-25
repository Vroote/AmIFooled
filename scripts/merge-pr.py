"""Fail-closed, best-effort merge gate; server branch protection is still required."""

import argparse
import json
import subprocess

REPO = "Vroote/AmIFooled"


def gh(*args):
    output = subprocess.check_output(["gh", *args], text=True)
    return json.loads(output) if output.strip() else None


def review_candidates(reviews, author, head):
    latest = {}
    for review in sorted(reviews, key=lambda item: item["id"]):
        if review["state"] in {"APPROVED", "CHANGES_REQUESTED", "DISMISSED"}:
            latest[review["user"]["login"]] = review
    if any(r["state"] == "CHANGES_REQUESTED" for r in latest.values()):
        raise ValueError("A reviewer still requests changes")
    return [
        login
        for login, review in latest.items()
        if login != author and review["state"] == "APPROVED" and review["commit_id"] == head
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("number", type=int)
    parser.add_argument("--merge", action="store_true", help="Perform reviewed squash merge")
    args = parser.parse_args()
    pr = gh("api", f"repos/{REPO}/pulls/{args.number}")
    if pr["state"] != "open" or pr["draft"] or pr["base"]["ref"] != "main":
        raise ValueError("Need an open, non-draft PR targeting main")
    if not pr.get("mergeable"):
        raise ValueError(
            "Mergeability is unknown or conflicts exist; retry after GitHub computes it"
        )
    head = pr["head"]["sha"]
    review_pages = gh(
        "api",
        "--paginate",
        "--slurp",
        f"repos/{REPO}/pulls/{args.number}/reviews?per_page=100",
    )
    candidates = review_candidates(
        [r for page in review_pages for r in page], pr["user"]["login"], head
    )
    approved = []
    for login in candidates:
        permission = gh("api", f"repos/{REPO}/collaborators/{login}/permission")["permission"]
        if permission in {"write", "maintain", "admin"}:
            approved.append(login)
    if not approved:
        raise ValueError(
            "Need one independent APPROVED review on current HEAD from a Write collaborator"
        )
    checks = gh("api", f"repos/{REPO}/commits/{head}/check-runs?check_name=ci&filter=latest")[
        "check_runs"
    ]
    if not any(
        c["name"] == "ci"
        and c["app"]["slug"] == "github-actions"
        and c["head_sha"] == head
        and c["status"] == "completed"
        and c["conclusion"] == "success"
        for c in checks
    ):
        raise ValueError("The ci check must succeed on current HEAD")
    query = 'query($n:Int!){repository(owner:"Vroote",name:"AmIFooled"){pullRequest(number:$n){reviewThreads(first:100){nodes{isResolved}pageInfo{hasNextPage}}}}}'
    threads = gh("api", "graphql", "-f", "query=" + query, "-F", f"n={args.number}")["data"][
        "repository"
    ]["pullRequest"]["reviewThreads"]
    if threads["pageInfo"]["hasNextPage"] or any(not t["isResolved"] for t in threads["nodes"]):
        raise ValueError("Unresolved review threads (or too many to verify automatically)")
    comparison = gh("api", f"repos/{REPO}/compare/main...{head}")
    if comparison["behind_by"]:
        raise ValueError("PR is behind main; update branch, rerun CI and obtain fresh approval")
    print(f"Ready: PR #{args.number}, {head}, approval by {', '.join(approved)}, ci passed")
    if args.merge:
        subprocess.run(
            [
                "gh",
                "pr",
                "merge",
                str(args.number),
                "-R",
                REPO,
                "--squash",
                "--match-head-commit",
                head,
                "--delete-branch",
            ],
            check=True,
        )
        print("Merged. Run python3 scripts/project-sync.py to reconcile the board.")
    else:
        print("No mutation performed. Add --merge to merge this reviewed PR.")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, subprocess.CalledProcessError) as exc:
        raise SystemExit(f"Merge blocked: {exc}") from exc
