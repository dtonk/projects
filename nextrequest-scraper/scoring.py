"""
Pure heuristic scoring -- no LLM calls. Everything here is string matching
and arithmetic, cheap enough to run over thousands of candidates.

Tuned for one goal: surface documents that would make a good "look at this
dataset" post -- not just "is this a spreadsheet" but "is this the kind of
spreadsheet someone leaked/released that people didn't expect to see."
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# Positive signal: words that show up in filenames/folders/request text when
# the underlying data is money, misconduct, or raw operational records.
POSITIVE_KEYWORDS = {
    # money / personnel
    "expense": 3, "expenses": 3, "transactions": 2, "transaction": 2,
    "salary": 3, "salaries": 3, "overtime": 3, "payroll": 3,
    "compensation": 2, "bonus": 2, "reimbursement": 2, "timesheet": 2,
    # accountability / misconduct
    "complaint": 3, "complaints": 3, "incident": 2, "incidents": 2,
    "violation": 3, "violations": 3, "citation": 2, "citations": 2,
    "misconduct": 4, "disciplinary": 3, "discipline": 2, "use of force": 4,
    "internal affairs": 4, "arrest": 2, "arrests": 2, "settlement": 3,
    "lawsuit": 3, "investigation": 2, "audit": 2, "ethics": 2,
    # raw operational data
    "inventory": 2, "roster": 2, "database": 2, "log": 1, "logs": 2,
    "export": 1, "dataset": 2, "records": 1, "tracker": 1, "master list": 2,
    "call log": 3, "dispatch": 2, "permits": 1, "inspections": 1,
    "violations list": 3, "vendor": 1, "contract": 1, "payments": 2,
}

# Negative signal: boilerplate / low-value attachments that happen to be
# csv/xlsx but aren't interesting (blank forms, single-record exports).
NEGATIVE_KEYWORDS = {
    "template": -3, "blank": -3, "form": -1, "invoice": -1, "receipt": -1,
    "signature": -2, "voicemail": -3, "sample": -2, "test": -2,
    "instructions": -2, "readme": -2, "cover sheet": -2, "agenda": -1,
    "minutes": -1, "resume": -2, "application": -1, "certificate": -1,
    "license": -1, "do not use": -3, "copy": -1, "duplicate": -1,
}

# Departments that, in practice, tend to release messier / more interesting
# raw data when they release anything at all. Small, deliberately gentle
# boost -- not meant to gatekeep, just a tiebreaker.
INTERESTING_DEPT_HINTS = [
    "police", "sheriff", "district attorney", "public works", "ethics",
    "human resources", "fire", "public health", "building inspection",
    "controller", "assessor", "treasurer",
]

_WORD_RE = re.compile(r"[a-z]+(?: [a-z]+)?")

# Hard floor: below this, drop the candidate outright regardless of keyword
# score -- these are near-empty stubs (a "Pasted HTML Table of Log.CSV" at
# 0 KB, a one-row "Export Summary" at 1 KB) that no amount of keyword
# matching should be able to rescue. xlsx/xls get a higher floor since the
# zip/xml container format has real overhead even for an empty workbook, so
# a small xlsx is less informative about actual content than a small csv.
MIN_SIZE_BYTES = {
    "csv": 2 * 1024,
    "xlsx": 6 * 1024,
    "xls": 6 * 1024,
}

# Applied when the open-data catalog cross-check (open_data.py) finds a
# strong name match on the city's existing open-data portal -- the document
# might still be real, but it's not a discovery if it's already public.
OPEN_DATA_DUPLICATE_PENALTY = -10

# request_text is identical across every file attached to a given request --
# a demand letter that mentions "complaints, misconduct, citations" inflates
# EVERY attachment under it equally, including boilerplate ones that have
# nothing to do with those words themselves. Capping how much the shared
# request context can contribute (vs. the file's own title/folder name,
# which stays at full weight) stops one juicy request from flooding the
# shortlist with its whole attachment batch.
REQUEST_TEXT_SCORE_CAP = 4


def passes_size_floor(file_extension: str, size_bytes: int | None) -> bool:
    """False only when we know the size and it's below the floor. Unknown
    sizes (None -- e.g. a failed HEAD/Range check) are let through rather
    than penalized, since that's a network hiccup, not a signal."""
    if size_bytes is None:
        return True
    floor = MIN_SIZE_BYTES.get(file_extension.lower(), 2 * 1024)
    return size_bytes >= floor


def _keyword_score(text: str) -> tuple[int, list[str]]:
    if not text:
        return 0, []
    t = text.lower()
    score = 0
    hits = []
    for kw, weight in POSITIVE_KEYWORDS.items():
        if kw in t:
            score += weight
            hits.append(kw)
    for kw, weight in NEGATIVE_KEYWORDS.items():
        if kw in t:
            score += weight
            hits.append(f"-{kw}")
    return score, hits


def _size_score(size_bytes: int | None) -> int:
    if size_bytes is None:
        return 0
    kb = size_bytes / 1024
    if kb < 5:
        return -3  # near-empty, probably one row or a stub
    if kb < 20:
        return 0
    if kb < 200:
        return 2
    if kb < 2000:
        return 3
    if kb < 20000:
        return 4
    return 5  # huge -- a full export/db dump, high curiosity value


def _dept_score(department_names: str) -> int:
    if not department_names:
        return 0
    d = department_names.lower()
    return 1 if any(hint in d for hint in INTERESTING_DEPT_HINTS) else 0


@dataclass
class ScoredCandidate:
    document_id: int
    title: str
    file_extension: str
    pretty_id: str
    department_names: str
    request_text: str
    folder_name: str | None
    size_bytes: int | None
    score: int
    reasons: list[str] = field(default_factory=list)
    is_open_data_duplicate: bool = False
    duplicate_of: str | None = None
    duplicate_url: str | None = None


def score_candidate(
    *,
    document_id: int,
    title: str,
    file_extension: str,
    pretty_id: str,
    department_names: str,
    request_text: str,
    folder_name: str | None,
    size_bytes: int | None,
    dedupe_result=None,  # open_data.DedupeResult, optional
) -> ScoredCandidate:
    # Full weight for signal that's specific to this file...
    file_text = " ".join(filter(None, [title, folder_name]))
    file_kw_score, file_kw_hits = _keyword_score(file_text)
    # ...dampened weight for signal that's just shared request context, so
    # it can nudge the score but can't single-handedly flood the shortlist
    # with an entire attachment batch.
    ctx_kw_score, ctx_kw_hits = _keyword_score(request_text or "")
    ctx_kw_score = max(-REQUEST_TEXT_SCORE_CAP, min(REQUEST_TEXT_SCORE_CAP, ctx_kw_score))

    kw_score = file_kw_score + ctx_kw_score
    kw_hits = list(file_kw_hits)
    if ctx_kw_score:
        kw_hits.append(f"request-context:{ctx_kw_score:+d} ({', '.join(ctx_kw_hits)})")

    sz_score = _size_score(size_bytes)
    dept_score = _dept_score(department_names)

    total = kw_score + sz_score + dept_score
    reasons = list(kw_hits)
    if sz_score:
        reasons.append(f"size:{sz_score:+d}")
    if dept_score:
        reasons.append("dept:+1")

    is_dup = bool(dedupe_result and dedupe_result.is_likely_duplicate)
    if is_dup:
        total += OPEN_DATA_DUPLICATE_PENALTY
        reasons.append(f"already-open-data:{OPEN_DATA_DUPLICATE_PENALTY:+d} ({dedupe_result.matched_name})")

    return ScoredCandidate(
        document_id=document_id,
        title=title,
        file_extension=file_extension,
        pretty_id=pretty_id,
        department_names=department_names,
        request_text=request_text,
        folder_name=folder_name,
        size_bytes=size_bytes,
        score=total,
        reasons=reasons,
        is_open_data_duplicate=is_dup,
        duplicate_of=dedupe_result.matched_name if is_dup else None,
        duplicate_url=dedupe_result.matched_url if is_dup else None,
    )
