"""DuckDB schema + helpers for the NextRequest dataset scout."""
from __future__ import annotations

import duckdb

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS closed_requests (
    portal              VARCHAR,
    pretty_id           VARCHAR,
    department_names    VARCHAR,
    request_text        VARCHAR,
    request_date        VARCHAR,
    due_date            VARCHAR,
    request_path        VARCHAR,
    crawled_at           TIMESTAMP DEFAULT current_timestamp,
    PRIMARY KEY (portal, pretty_id)
);

CREATE TABLE IF NOT EXISTS document_candidates (
    portal              VARCHAR,
    document_id         BIGINT,
    title               VARCHAR,
    file_extension      VARCHAR,
    pretty_id           VARCHAR,
    folder_name         VARCHAR,
    created_at_str      VARCHAR,
    document_path       VARCHAR,
    request_path        VARCHAR,
    matched_term        VARCHAR,
    crawled_at           TIMESTAMP DEFAULT current_timestamp,
    PRIMARY KEY (portal, document_id)
);

-- Every candidate that made it into the size-check_pool and passed the size
-- floor, i.e. everything that was actually network-checked (size +
-- open-data dedupe) -- not just the diversity-capped top_n that ends up in
-- `shortlist`. Same shape as `shortlist`, just uncapped.
CREATE TABLE IF NOT EXISTS scored_pool (
    portal              VARCHAR,
    document_id         BIGINT,
    title               VARCHAR,
    file_extension      VARCHAR,
    pretty_id           VARCHAR,
    department_names    VARCHAR,
    request_text        VARCHAR,
    folder_name         VARCHAR,
    size_bytes          BIGINT,
    score               INTEGER,
    reasons             VARCHAR,
    download_url        VARCHAR,
    is_open_data_duplicate BOOLEAN,
    duplicate_of        VARCHAR,
    duplicate_url        VARCHAR,
    scored_at           TIMESTAMP DEFAULT current_timestamp,
    PRIMARY KEY (portal, document_id)
);

CREATE TABLE IF NOT EXISTS shortlist (
    portal              VARCHAR,
    document_id         BIGINT,
    title               VARCHAR,
    file_extension      VARCHAR,
    pretty_id           VARCHAR,
    department_names    VARCHAR,
    request_text        VARCHAR,
    folder_name         VARCHAR,
    size_bytes          BIGINT,
    score               INTEGER,
    reasons             VARCHAR,
    download_url        VARCHAR,
    is_open_data_duplicate BOOLEAN,
    duplicate_of        VARCHAR,
    duplicate_url        VARCHAR,
    scored_at           TIMESTAMP DEFAULT current_timestamp,
    PRIMARY KEY (portal, document_id)
);
"""


# Columns added after the initial release -- applied with ADD COLUMN IF NOT
# EXISTS so existing db files (which already have closed_requests /
# document_candidates crawled, expensive to redo) pick them up in place
# instead of needing a fresh file.
MIGRATIONS_SQL = """
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS is_open_data_duplicate BOOLEAN;
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS duplicate_of VARCHAR;
ALTER TABLE shortlist ADD COLUMN IF NOT EXISTS duplicate_url VARCHAR;
"""


def connect(path: str) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect(path)
    con.execute(SCHEMA_SQL)
    con.execute(MIGRATIONS_SQL)
    return con
