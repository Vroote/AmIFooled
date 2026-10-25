"""Strict DNS/IDNA boundary and offline PSL matching, including tenant suffixes."""

import ipaddress
import re

import idna
import tldextract

_extract = tldextract.TLDExtract(
    suffix_list_urls=(), cache_dir=None, include_psl_private_domains=True
)
_label = re.compile(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\Z")


def normalize_domain(value: str) -> tuple[str, str]:
    """Return canonical hostname and PSL registrable domain; do not resolve DNS."""
    try:
        hostname = idna.encode(value, uts46=True, std3_rules=True).decode("ascii").lower()
    except (idna.IDNAError, UnicodeError) as exc:
        raise ValueError("Expected a public DNS hostname") from exc
    if hostname.endswith("."):
        hostname = hostname[:-1]
    if len(hostname) > 253 or not all(_label.fullmatch(x) for x in hostname.split(".")):
        raise ValueError("Expected a public DNS hostname")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError("IP addresses are not supported")
    # Also reject numeric IPv4-like shorthand rather than treating it as a domain.
    if hostname.rsplit(".", 1)[-1].isdigit():
        raise ValueError("Expected a public DNS hostname")
    result = _extract(hostname)
    if result.is_private and not result.domain:
        # The platform hostname itself may be checked, without mapping tenants to it.
        return hostname, hostname
    if not result.suffix or not result.domain:
        raise ValueError("Expected a registrable public DNS hostname")
    return hostname, result.top_domain_under_public_suffix
