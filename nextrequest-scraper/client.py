"""
Thin client for the public JSON endpoints behind a NextRequest public-records
portal (e.g. https://sanfrancisco.nextrequest.com).

These are the same endpoints the portal's own Vue frontend calls to render
the public request list and document search pages — no auth required, no
API key. Reverse-engineered by inspecting the portal's JS bundles; see
README.md for how they were found and what they return.

Endpoints used:
  GET /client/requests?page_number=N&closed=true
      -> paginated list of requests (100/page, fixed, per_page is ignored)
  GET /client/documents?search_term=X&page_number=N&page_size=50
      -> portal-wide document index, full-text-ish search over filename/desc
  GET /documents/{id}/download   (with Range: bytes=0-0)
      -> 302 to a signed S3 URL; a 1-byte range request returns the true
         file size in Content-Range without downloading the file
"""
from __future__ import annotations

import time
import random
from dataclasses import dataclass

import requests

USER_AGENT = "nextrequest-dataset-scout/0.1 (research script; contact: mr.tonkovich@gmail.com)"

# Politeness: min delay between requests to a given portal. NextRequest is
# shared infra for many small government IT departments -- no reason to
# hammer it just because the API is open.
DEFAULT_DELAY = 0.35


@dataclass
class FileSizeResult:
    ok: bool
    size_bytes: int | None
    status_code: int | None


class NextRequestClient:
    def __init__(self, host: str, delay: float = DEFAULT_DELAY, timeout: float = 20.0):
        """host: bare portal hostname, e.g. 'sanfrancisco.nextrequest.com'"""
        self.host = host
        self.base = f"https://{host}"
        self.delay = delay
        self.timeout = timeout
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": USER_AGENT,
            "Accept": "application/json",
        })

    def _sleep(self):
        time.sleep(self.delay + random.uniform(0, self.delay * 0.3))

    def _get(self, path: str, params: dict | None = None) -> requests.Response:
        resp = self.session.get(f"{self.base}{path}", params=params, timeout=self.timeout)
        self._sleep()
        return resp

    def get_requests_page(self, page: int, closed: bool = True, sort_order: str = "desc") -> dict:
        """One page (100 rows, fixed by the server) of the request list.

        Note: the pagination param is `page_number`, not `page` -- a plain
        `page=N` is silently ignored server-side and always returns page 1.
        Found by trial and error against the live API since the frontend
        bundle just forwards the current route's query string verbatim.

        The server also hard-caps `page_number` at 100 (422 "must be less
        than or equal to 100") -- i.e. only the first 10,000 results of any
        given sort order are reachable (an Elasticsearch default-window-style
        limit). See iter_all_requests for how this is worked around."""
        resp = self._get("/client/requests", params={
            "page_number": page, "closed": str(closed).lower(), "sort_order": sort_order,
        })
        resp.raise_for_status()
        return resp.json()

    def iter_all_requests(self, closed: bool = True):
        """Yields every request row, working around the 10,000-row/sort-order
        pagination ceiling by walking from both ends (desc then asc) and
        letting the caller dedupe by id. Covers the full set as long as
        total_count <= 20,000; beyond that a smaller slicing strategy
        (e.g. by department or date range) would be needed."""
        seen_ids = set()
        for sort_order in ("desc", "asc"):
            page = 1
            while page <= 100:
                data = self.get_requests_page(page, closed=closed, sort_order=sort_order)
                rows = data.get("requests", [])
                if not rows:
                    break
                new_rows = [r for r in rows if r.get("id") not in seen_ids]
                for r in new_rows:
                    seen_ids.add(r.get("id"))
                yield from new_rows
                total = data.get("total_count", 0)
                if page * 100 >= total or page * 100 >= 10000:
                    break
                page += 1
            if len(seen_ids) >= data.get("total_count", 0):
                return

    def search_documents_page(self, search_term: str, page_number: int, page_size: int = 50,
                               sort_order: str = "desc") -> dict:
        resp = self._get("/client/documents", params={
            "search_term": search_term,
            "page_number": page_number,
            "page_size": page_size,
            "sort_order": sort_order,
        })
        resp.raise_for_status()
        return resp.json()

    def iter_search_documents(self, search_term: str, page_size: int = 50, max_pages: int | None = None):
        """Yields every document row matching a search term.

        Same ~10,000-result Elasticsearch-style window ceiling as the
        requests endpoint (here: page_number capped at floor(9999/page_size),
        e.g. 199 at page_size=50 -- "must be less than or equal to 199").
        Worked around the same way: walk from both ends (desc then asc) and
        dedupe by id. Covers the full result set as long as total_count
        <= ~2x the reachable window; xlsx/xls totals on SF (~13k/~15k) are
        within range of that for page_size=50."""
        seen_ids = set()
        max_reachable_page = max(1, 9999 // page_size)
        effective_max = max_reachable_page if max_pages is None else min(max_reachable_page, max_pages)
        for sort_order in ("desc", "asc"):
            page_number = 1
            total = 0
            while True:
                data = self.search_documents_page(search_term, page_number, page_size=page_size, sort_order=sort_order)
                rows = data.get("documents", [])
                total = data.get("total_count", 0)
                if not rows:
                    break
                new_rows = [r for r in rows if r.get("id") not in seen_ids]
                for r in new_rows:
                    seen_ids.add(r.get("id"))
                yield from new_rows
                if page_number * page_size >= total or page_number >= effective_max:
                    break
                page_number += 1
            if len(seen_ids) >= total:
                return

    def get_file_size(self, document_id: int) -> FileSizeResult:
        """Real byte size via a 1-byte Range request through the download
        redirect -- avoids pulling the whole file just to check its size."""
        try:
            resp = self.session.get(
                f"{self.base}/documents/{document_id}/download",
                headers={"Range": "bytes=0-0"},
                timeout=self.timeout,
                allow_redirects=True,
                stream=True,
            )
            resp.close()
        except requests.RequestException:
            self._sleep()
            return FileSizeResult(ok=False, size_bytes=None, status_code=None)
        self._sleep()
        content_range = resp.headers.get("Content-Range")  # "bytes 0-0/22192"
        if content_range and "/" in content_range:
            try:
                size = int(content_range.rsplit("/", 1)[1])
                return FileSizeResult(ok=True, size_bytes=size, status_code=resp.status_code)
            except ValueError:
                pass
        # Fallback: some responses may just return Content-Length of the whole
        # file if the server ignores Range.
        cl = resp.headers.get("Content-Length")
        if cl and resp.status_code == 200:
            return FileSizeResult(ok=True, size_bytes=int(cl), status_code=resp.status_code)
        return FileSizeResult(ok=False, size_bytes=None, status_code=resp.status_code)
