"""
Orchestrates the pipeline described in README.md:

  1. crawl_closed_requests  -- every closed request on the portal
  2. crawl_document_candidates -- document index, searched by a handful of
     filetype-ish terms, filtered down to real csv/xls/xlsx by file_extension
  3. build_shortlist -- join candidates to closed requests, pre-score by
     keywords only (free), then spend real HTTP calls checking file size
     (1-byte Range request) on only the top pre-scored candidates, and
     produce the final ranked shortlist.

No LLM calls anywhere in this file.
"""
from __future__ import annotations

import sys

from client import NextRequestClient
from db import connect
from open_data import KNOWN_OPEN_DATA_DOMAINS, OpenDataCatalogClient
from scoring import passes_size_floor, score_candidate

TARGET_EXTENSIONS = {"csv", "xlsx", "xls"}
# Search terms fed to the document-index search_term filter. This is a fuzzy
# full-text match, not a real filetype filter -- we still verify
# file_extension client-side. Multiple terms because the tokenizer seems to
# split on filename punctuation inconsistently (xlsx also surfaces some xls
# hits and vice versa, but casting a slightly wider net costs little).
SEARCH_TERMS = ["csv", "xlsx", "xls"]


def crawl_closed_requests(client: NextRequestClient, con, portal: str, limit: int | None = None):
    n = 0
    for req in client.iter_all_requests(closed=True):
        con.execute(
            """INSERT INTO closed_requests
               (portal, pretty_id, department_names, request_text, request_date, due_date, request_path)
               VALUES (?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (portal, pretty_id) DO NOTHING""",
            [
                portal,
                req.get("id"),
                req.get("department_names"),
                req.get("request_text"),
                req.get("request_date"),
                req.get("due_date"),
                req.get("request_path"),
            ],
        )
        n += 1
        if n % 500 == 0:
            print(f"  ...{n} closed requests crawled", file=sys.stderr)
        if limit and n >= limit:
            break
    print(f"closed_requests: {n} rows crawled for {portal}", file=sys.stderr)


def crawl_document_candidates(client: NextRequestClient, con, portal: str, max_pages_per_term: int | None = None):
    seen_ids = set()
    total_inserted = 0
    for term in SEARCH_TERMS:
        n = 0
        for doc in client.iter_search_documents(term, page_size=50, max_pages=max_pages_per_term):
            ext = (doc.get("file_extension") or "").lower()
            if ext not in TARGET_EXTENSIONS:
                continue
            doc_id = doc.get("id")
            if doc_id in seen_ids:
                continue
            seen_ids.add(doc_id)
            con.execute(
                """INSERT INTO document_candidates
                   (portal, document_id, title, file_extension, pretty_id, folder_name,
                    created_at_str, document_path, request_path, matched_term)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT (portal, document_id) DO NOTHING""",
                [
                    portal, doc_id, doc.get("title"), ext, doc.get("pretty_id"),
                    doc.get("folder_name"), doc.get("created_at"), doc.get("document_path"),
                    doc.get("request_path"), term,
                ],
            )
            n += 1
            total_inserted += 1
        print(f"  search_term={term!r}: {n} matching-extension candidates", file=sys.stderr)
    print(f"document_candidates: {total_inserted} unique rows for {portal}", file=sys.stderr)


def build_shortlist(client: NextRequestClient, con, portal: str, top_n: int = 25, size_check_pool: int = 150,
                     open_data_domain: str | None = "auto", exclude_open_data_dupes: bool = False,
                     max_per_request: int = 2):
    # Only candidates attached to CLOSED requests.
    rows = con.execute(
        """
        SELECT d.document_id, d.title, d.file_extension, d.pretty_id, d.folder_name,
               r.department_names, r.request_text
        FROM document_candidates d
        JOIN closed_requests r ON r.portal = d.portal AND r.pretty_id = d.pretty_id
        WHERE d.portal = ?
        """,
        [portal],
    ).fetchall()
    print(f"candidates attached to a closed request: {len(rows)}", file=sys.stderr)

    # Free pre-score: keywords only, no network calls, no size yet.
    prescored = []
    for (doc_id, title, ext, pretty_id, folder_name, dept, req_text) in rows:
        pre = score_candidate(
            document_id=doc_id, title=title, file_extension=ext, pretty_id=pretty_id,
            department_names=dept, request_text=req_text, folder_name=folder_name,
            size_bytes=None,
        )
        prescored.append(pre)
    prescored.sort(key=lambda c: c.score, reverse=True)

    # Spend real HTTP calls (size check + open-data dedupe check) only on the
    # most promising pool -- this is the expensive step, so keep it bounded
    # regardless of how many thousand candidates exist portal-wide.
    pool = prescored[:size_check_pool]

    if open_data_domain == "auto":
        open_data_domain = KNOWN_OPEN_DATA_DOMAINS.get(portal)
    catalog = OpenDataCatalogClient(open_data_domain)
    if open_data_domain:
        print(f"checking top {len(pool)} candidates for size + open-data duplicates ({open_data_domain})...", file=sys.stderr)
    else:
        print(f"checking real file size for top {len(pool)} pre-scored candidates "
              f"(no open-data domain known for {portal} -- dedupe check skipped)...", file=sys.stderr)

    final = []
    dropped_tiny = 0
    dropped_dupe = 0
    for i, c in enumerate(pool, 1):
        size_result = client.get_file_size(c.document_id)
        dedupe_result = catalog.check(c.title)
        final_c = score_candidate(
            document_id=c.document_id, title=c.title, file_extension=c.file_extension,
            pretty_id=c.pretty_id, department_names=c.department_names,
            request_text=c.request_text, folder_name=c.folder_name,
            size_bytes=size_result.size_bytes, dedupe_result=dedupe_result,
        )
        if not passes_size_floor(final_c.file_extension, final_c.size_bytes):
            dropped_tiny += 1
        elif exclude_open_data_dupes and final_c.is_open_data_duplicate:
            dropped_dupe += 1
        else:
            final.append(final_c)
        if i % 25 == 0:
            print(f"  ...{i}/{len(pool)} checked", file=sys.stderr)

    print(f"dropped {dropped_tiny} below the size floor"
          + (f", {dropped_dupe} as likely open-data duplicates" if exclude_open_data_dupes else ""),
          file=sys.stderr)

    final.sort(key=lambda c: c.score, reverse=True)

    # Persist every network-checked candidate (not just the top_n) so a full
    # "here's everything we scored" export is possible without re-spending
    # the HTTP calls.
    _persist(con, portal, final, "scored_pool")

    # Diversity cap: even with request_text's contribution capped (scoring.py),
    # a request with a large batch of attachments can still fill the whole
    # shortlist with near-duplicate files sharing similar names/keywords.
    # Greedily take the best-scoring candidates but stop admitting more from
    # any one request past max_per_request, so the list is 50 different
    # stories rather than one story's whole attachment folder.
    top = []
    per_request_count: dict[str, int] = {}
    for c in final:
        if per_request_count.get(c.pretty_id, 0) >= max_per_request:
            continue
        top.append(c)
        per_request_count[c.pretty_id] = per_request_count.get(c.pretty_id, 0) + 1
        if len(top) >= top_n:
            break

    _persist(con, portal, top, "shortlist")
    return top


def _persist(con, portal: str, candidates, table: str):
    for c in candidates:
        download_url = f"https://{portal}/documents/{c.document_id}/download"
        con.execute(
            f"""INSERT INTO {table}
               (portal, document_id, title, file_extension, pretty_id, department_names,
                request_text, folder_name, size_bytes, score, reasons, download_url,
                is_open_data_duplicate, duplicate_of, duplicate_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (portal, document_id) DO UPDATE SET
                 size_bytes = excluded.size_bytes, score = excluded.score,
                 reasons = excluded.reasons, is_open_data_duplicate = excluded.is_open_data_duplicate,
                 duplicate_of = excluded.duplicate_of, duplicate_url = excluded.duplicate_url,
                 scored_at = now()""",
            [
                portal, c.document_id, c.title, c.file_extension, c.pretty_id,
                c.department_names, c.request_text, c.folder_name, c.size_bytes,
                c.score, ", ".join(c.reasons), download_url,
                c.is_open_data_duplicate, c.duplicate_of, c.duplicate_url,
            ],
        )


def run(portal: str, db_path: str, top_n: int = 25, size_check_pool: int = 150,
        request_limit: int | None = None, doc_pages_per_term: int | None = None,
        open_data_domain: str | None = "auto", exclude_open_data_dupes: bool = False,
        max_per_request: int = 2):
    client = NextRequestClient(portal)
    con = connect(db_path)

    print(f"== 1/3 crawling closed requests for {portal} ==", file=sys.stderr)
    crawl_closed_requests(client, con, portal, limit=request_limit)

    print(f"== 2/3 crawling document candidates ==", file=sys.stderr)
    crawl_document_candidates(client, con, portal, max_pages_per_term=doc_pages_per_term)

    print(f"== 3/3 scoring + shortlisting ==", file=sys.stderr)
    top = build_shortlist(client, con, portal, top_n=top_n, size_check_pool=size_check_pool,
                           open_data_domain=open_data_domain, exclude_open_data_dupes=exclude_open_data_dupes,
                           max_per_request=max_per_request)

    con.close()
    return top
