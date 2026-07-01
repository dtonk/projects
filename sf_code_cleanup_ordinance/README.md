# Leg Ver3,4 — parsed artifacts

Source: `~/Desktop/Leg Ver34.pdf` (362 pp). In the PDF, **strikethrough = deleted text**,
**underline = added text**; both are drawn as thin bars over the words, classified here by
vertical position.

## Files
- **SUMMARY.md** — plain-language summary of the large & medium changes. Start here.
- **document.md** — full readable text with markup preserved: `~~deleted~~`, `__added__`.
- **document.jsonl** — one JSON record per paragraph for analysis:
  `{id, page, section, changed, runs:[{kind: unchanged|added|deleted, text}]}`
- **change_blocks.json** — only the paragraphs that contain edits, with per-paragraph
  added/deleted text and character-length sizes (used to rank changes).
- **parse_pdf.py** — the parser that produced the artifacts above.

## Re-run / tweak
`parse_pdf.py` regenerates `document.md`, `document.jsonl`, and `change_blocks.json`
from the source PDF (requires `pymupdf`; edit the `SRC`/`OUT` paths at the top).
Extend it for finer paragraph splitting, a clean "before"/"after" version, or a
topic-filtered view (e.g. only changes mentioning a given program).
