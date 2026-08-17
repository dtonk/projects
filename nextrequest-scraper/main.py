#!/usr/bin/env python3
"""
CLI entrypoint.

  python main.py --portal sanfrancisco.nextrequest.com

  # Faster smoke test against a smaller slice:
  python main.py --portal sanfrancisco.nextrequest.com --request-limit 2000 --doc-pages-per-term 4
"""
from __future__ import annotations

import argparse

from crawl import run


def main():
    ap = argparse.ArgumentParser(description="Scout closed NextRequest requests for interesting csv/xlsx attachments.")
    ap.add_argument("--portal", required=True, help="portal hostname, e.g. sanfrancisco.nextrequest.com")
    ap.add_argument("--db", default="nextrequest.duckdb", help="duckdb file to write to")
    ap.add_argument("--top-n", type=int, default=25, help="shortlist size")
    ap.add_argument("--size-check-pool", type=int, default=150,
                     help="how many top pre-scored candidates get a real HTTP size check")
    ap.add_argument("--request-limit", type=int, default=None,
                     help="cap on closed requests crawled (for smoke tests)")
    ap.add_argument("--doc-pages-per-term", type=int, default=None,
                     help="cap on document-search pages per search term (for smoke tests)")
    ap.add_argument("--open-data-domain", default="auto",
                     help="Socrata open-data hostname to cross-check against, e.g. data.sfgov.org. "
                          "'auto' (default) looks it up from a small known-cities table; pass '' to disable.")
    ap.add_argument("--exclude-open-data-dupes", action="store_true",
                     help="drop candidates that strongly match an existing open-data dataset "
                          "instead of just down-ranking them")
    ap.add_argument("--max-per-request", type=int, default=2,
                     help="cap on how many shortlisted documents can come from the same request "
                          "(keeps one large attachment batch from filling the whole list)")
    args = ap.parse_args()

    open_data_domain = args.open_data_domain if args.open_data_domain != "" else None

    top = run(
        portal=args.portal,
        db_path=args.db,
        top_n=args.top_n,
        size_check_pool=args.size_check_pool,
        request_limit=args.request_limit,
        doc_pages_per_term=args.doc_pages_per_term,
        open_data_domain=open_data_domain,
        exclude_open_data_dupes=args.exclude_open_data_dupes,
        max_per_request=args.max_per_request,
    )

    print(f"\n=== Top {len(top)} shortlist for {args.portal} ===\n")
    for i, c in enumerate(top, 1):
        size_kb = f"{c.size_bytes/1024:,.0f} KB" if c.size_bytes else "size unknown"
        flag = "  [ALREADY ON OPEN DATA]" if c.is_open_data_duplicate else ""
        print(f"{i:>2}. [{c.score:+d}] {c.title}  ({size_kb}){flag}")
        print(f"     request {c.pretty_id} -- {c.department_names}")
        print(f"     https://{args.portal}/documents/{c.document_id}/download")
        if c.is_open_data_duplicate:
            print(f"     matches: {c.duplicate_of} -- {c.duplicate_url}")
        if c.reasons:
            print(f"     signals: {', '.join(c.reasons)}")
        print()


if __name__ == "__main__":
    main()
