"""
Cross-check candidates against a city's open-data portal, to down-rank
documents that are "interesting" only because we don't already know they're
published as a routine open dataset -- e.g. SF publishes both annual
Employee Compensation and Vendor Payments on data.sfgov.org already, so
finding them via a records request isn't a discovery.

Most US local governments that publish open data use Socrata, which exposes
a public, unauthenticated, cross-portal catalog search API
(api.us.socrata.com/api/catalog/v1). No LLM, no auth, one plain REST call
per candidate.

This is deliberately conservative: Socrata's catalog has hundreds of
thousands of datasets, so a bare "some result came back" is meaningless --
almost any query returns *something*. A match only counts if the cleaned
candidate title and a result's name have strong token overlap (see
`significant_tokens`).
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import requests

CATALOG_URL = "https://api.us.socrata.com/api/catalog/v1"

# Portals we know are backed by a Socrata open-data domain. Best-effort and
# manually maintained -- not every NextRequest city runs Socrata (some use
# ArcGIS Open Data, CKAN, or nothing at all). Override with
# --open-data-domain, or leave unmapped to skip this check entirely.
KNOWN_OPEN_DATA_DOMAINS = {
    "sanfrancisco.nextrequest.com": "data.sfgov.org",
}

STOPWORDS = {
    "csv", "xlsx", "xls", "data", "export", "file", "files", "list",
    "report", "reports", "summary", "draft", "final", "copy", "redacted",
    "new", "old", "update", "updated", "current", "the", "and", "for",
    "of", "by", "san", "francisco", "dept", "department", "city", "county",
}

_TOKEN_RE = re.compile(r"[a-z]+")


def significant_tokens(text: str) -> set[str]:
    """Lowercase, split on non-letters, drop stopwords/digits/short tokens.
    Digits are dropped implicitly since _TOKEN_RE only matches letters --
    this also strips dates/ids embedded in filenames like '_20240524'."""
    tokens = _TOKEN_RE.findall(text.lower())
    return {t for t in tokens if len(t) > 2 and t not in STOPWORDS}


@dataclass
class DedupeResult:
    checked: bool
    is_likely_duplicate: bool
    matched_name: str | None = None
    matched_url: str | None = None
    similarity: float = 0.0


class OpenDataCatalogClient:
    def __init__(self, domain: str | None, timeout: float = 10.0):
        """domain: the city's Socrata open-data hostname, e.g. 'data.sfgov.org'.
        Pass None to disable checking entirely (unknown/non-Socrata city)."""
        self.domain = domain
        self.timeout = timeout
        self.session = requests.Session()

    def check(self, title: str, min_tokens: int = 2, min_similarity: float = 0.5) -> DedupeResult:
        if not self.domain:
            return DedupeResult(checked=False, is_likely_duplicate=False)

        candidate_tokens = significant_tokens(title)
        if len(candidate_tokens) < min_tokens:
            # Too little signal in the filename to compare responsibly --
            # e.g. "violations.csv" -> {"violations"} alone isn't enough to
            # safely say it matches (or doesn't match) any given dataset.
            return DedupeResult(checked=False, is_likely_duplicate=False)

        try:
            resp = self.session.get(CATALOG_URL, params={
                "search_context": self.domain,
                "q": " ".join(sorted(candidate_tokens)),
                "limit": 5,
            }, timeout=self.timeout)
            resp.raise_for_status()
            data = resp.json()
        except requests.RequestException:
            return DedupeResult(checked=False, is_likely_duplicate=False)

        best_sim = 0.0
        best_name = None
        best_url = None
        for r in data.get("results", []):
            name = r.get("resource", {}).get("name", "")
            result_tokens = significant_tokens(name)
            if not result_tokens:
                continue
            overlap = candidate_tokens & result_tokens
            union = candidate_tokens | result_tokens
            sim = len(overlap) / len(union) if union else 0.0
            if sim > best_sim:
                best_sim = sim
                best_name = name
                best_url = r.get("permalink")

        is_dup = best_sim >= min_similarity
        return DedupeResult(
            checked=True,
            is_likely_duplicate=is_dup,
            matched_name=best_name if is_dup else None,
            matched_url=best_url if is_dup else None,
            similarity=best_sim,
        )
