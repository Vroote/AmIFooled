"""Quote location and third-party comparison helpers.

Every helper here works on the policy text the user explicitly submitted. Nothing in
this module logs, stores, or forwards that text.
"""

from __future__ import annotations

MAX_QUOTE_LENGTH = 300


def find_exact_quote(policy_text: str, quote: str) -> str | None:
    """Return the quote exactly as it appears in the policy, or None when absent.

    Comparison is case-insensitive so a provider may echo a differently cased span,
    but the returned value is always the real substring of the submitted policy.
    """
    candidate = quote.strip()
    if not candidate or len(candidate) > MAX_QUOTE_LENGTH:
        return None
    index = policy_text.lower().find(candidate.lower())
    if index == -1:
        return None
    return policy_text[index : index + len(candidate)]


def collapse_whitespace(value: str) -> str:
    return " ".join(value.split())


def _registrable_tail(hostname: str) -> str:
    """Compare the last two labels.

    This is intentionally not a Public Suffix List lookup: PSL handling belongs to the
    breaches task. Two labels over-group hosts under suffixes such as co.uk, so the
    limitation is reported to the user instead of being hidden.
    """
    labels = [label for label in hostname.lower().strip(".").split(".") if label]
    if labels and labels[0] == "www":
        labels = labels[1:]
    return ".".join(labels[-2:]) if len(labels) >= 2 else ".".join(labels)


def is_third_party(resource_hostname: str, page_hostname: str) -> bool:
    resource_tail = _registrable_tail(resource_hostname)
    page_tail = _registrable_tail(page_hostname)
    if not resource_tail or not page_tail:
        return False
    return resource_tail != page_tail
