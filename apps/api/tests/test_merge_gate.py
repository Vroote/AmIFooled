import importlib.util
from pathlib import Path

import pytest

script = Path(__file__).resolve().parents[3] / "scripts/merge-pr.py"
spec = importlib.util.spec_from_file_location("merge_gate", script)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def review(number, user="reviewer", state="APPROVED", sha="current"):
    return {"id": number, "user": {"login": user}, "state": state, "commit_id": sha}


def test_self_or_stale_approval_is_not_accepted():
    assert (
        module.review_candidates(
            [review(1, user="author"), review(2, sha="old")], "author", "current"
        )
        == []
    )


def test_later_changes_request_blocks_approval():
    with pytest.raises(ValueError, match="requests changes"):
        module.review_candidates(
            [review(1), review(2, state="CHANGES_REQUESTED")], "author", "current"
        )


def test_comment_does_not_revoke_valid_approval():
    assert module.review_candidates(
        [review(1), review(2, state="COMMENTED")], "author", "current"
    ) == ["reviewer"]


def test_dismissed_review_is_not_accepted():
    assert module.review_candidates([review(1, state="DISMISSED")], "author", "current") == []
