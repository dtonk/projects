# nextrequest-scraper

Finds potentially "look at this dataset" documents on public NextRequest
records portals (e.g. `sanfrancisco.nextrequest.com`) — closed requests that
have a csv/xlsx/xls attachment, ranked by cheap heuristics rather than
opening every file or running anything through an LLM.

## Why this works: undocumented-but-public JSON endpoints

NextRequest's public request-list and document-search pages are a Vue SPA.
The raw HTML has no data in it — but the SPA calls plain unauthenticated
JSON endpoints to render itself, and those are usable directly. Found by
downloading the portal's JS bundles (`assets.nextrequest.com/vite/assets/*.js`)
and grepping for the API client's endpoint definitions.

| Endpoint | Purpose |
|---|---|
| `GET /client/requests?page_number=N&closed=true` | Paginated closed-request list. Page size is fixed at 100 server-side (`per_page` is accepted but ignored). Note it's `page_number`, not `page` — a plain `page=N` is silently ignored and always returns page 1; found by trial and error since the frontend just forwards whatever's in the URL bar. |
| `GET /client/documents?search_term=X&page_number=N&page_size=50&sort_order=asc\|desc` | Portal-wide document index (every uploaded file, ~617k for SF). `search_term` is a fuzzy full-text match over filename/description, **not** a real filetype filter — used here only to cheaply narrow down candidates before filtering on the real `file_extension` field client-side. `page_size` is capped at 50; anything higher silently breaks the response. Same ~10,000-result window ceiling as `/client/requests` (`page_number` capped at `floor(9999/page_size)`, e.g. 199 at page_size=50 — `"must be less than or equal to 199"`); worked around the same way, walking both `sort_order`s and deduping by id. |
| `GET /documents/{id}/download` | 302-redirects to a presigned S3 URL. The API never exposes a real file-size field (`file_size` is always `null`), so size is checked by sending this request with `Range: bytes=0-0` and reading the total from the `Content-Range` response header — gets the true byte count while transferring ~1 byte. Must be a GET, not a HEAD (the S3 signature is method-scoped). |
| `GET api.us.socrata.com/api/catalog/v1?search_context={domain}&q=...` | Not a NextRequest endpoint — Socrata's public cross-portal open-data catalog search, used to down-rank documents that are already published as routine open data on the city's own portal (see `open_data.py`). `search_context={domain}` scopes results to that city; `domains={domain}` (the more obvious-looking param) silently returns nothing. |

`robots.txt` only excludes SEO crawlers (Ahrefs, dotbot, etc.), not a
blanket disallow. The client still self-throttles (`DEFAULT_DELAY` in
`client.py`) and identifies itself with a descriptive User-Agent — this is
shared infrastructure for a lot of small government IT departments, no
reason to hammer it just because the API happens to be open.

## Pipeline (`crawl.py`)

No LLM calls anywhere in this repo. The whole point is to filter hard enough
with cheap heuristics that a human (or eventually an LLM, on a short list
only) only has to look at a couple dozen candidates.

1. **`crawl_closed_requests`** — every closed request on the portal into
   `closed_requests` (id, department, request text, dates).
2. **`crawl_document_candidates`** — search the document index for
   `csv`/`xlsx`/`xls`, keep only rows whose real `file_extension` matches,
   into `document_candidates`.
3. **`build_shortlist`**:
   - join candidates to `closed_requests` (drop anything not attached to a
     closed request)
   - **free pre-score**: keyword scoring only (`scoring.py`), no network
     calls — money/misconduct/raw-data words score up, boilerplate
     (templates, blank forms, voicemail exports) scores down
   - spend real HTTP calls (the Range-request size check) on only the
     top `--size-check-pool` pre-scored candidates, not every candidate
   - final score = keywords + size bucket (very small files penalized,
     large ones rewarded) + a small department tiebreaker (PD, Sheriff, DA,
     Public Works, Ethics, HR — departments that tend to release messier
     raw data)
   - top `--top-n` written to the `shortlist` table and printed

## Usage

```bash
python -m venv .venv && .venv/bin/pip install -r requirements.txt

# full run
.venv/bin/python main.py --portal sanfrancisco.nextrequest.com

# smoke test on a slice
.venv/bin/python main.py --portal sanfrancisco.nextrequest.com \
    --db smoketest.duckdb --doc-pages-per-term 4 --top-n 10 --size-check-pool 40
```

Data lands in a DuckDB file (`nextrequest.duckdb` by default) with three
tables: `closed_requests`, `document_candidates`, `shortlist`.

## Scaling to other cities

Every NextRequest-hosted portal runs the same app on `{city}.nextrequest.com`
— same endpoints, same JSON shapes. `--portal` is the only thing that
changes. Not yet built: a list of known NextRequest client cities to loop
over.

## Not solved yet / next steps

- `scoring.py`'s keyword lists are a first pass, easy to extend.
- No peek inside the actual file (row/column count, "does this even parse as
  tabular data") — would catch junk that only looks good from metadata.
  Cheap to add for the final shortlist only (pandas/duckdb read, still no
  LLM).
- No multi-city loop yet.
