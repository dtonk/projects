"""Extract SF elected officials' Schedule A1 (stock) holdings from the Form 700 dataset.

Reads the NetFile SEI holdings dataset, keeps only the officials listed in
roster.csv, takes each one's most recent (non-superseded) filing, and writes the
Schedule A1 rows to data/holdings.csv.
"""
import csv, json, os, sys, urllib.request
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
SEI_CSV = os.path.join(DATA, "netfile_sei_holdings.csv")
SEI_URL = "https://danalytics.reliquery.net/api/datasets/jexvgs/download?format=csv"

PREFIX = os.environ.get("SF700_PREFIX", "")          # namespaces outputs
ROSTER_CSV = os.path.join(HERE, os.environ.get("SF700_ROSTER", "roster.csv"))

# Form 700 fair market value bands. Code 4 is open-ended ("Over $1,000,000");
# per project decision we value it at its floor, $1,000,000 (conservative).
FMV_BANDS = {
    "1": (2_000,     10_000),
    "2": (10_001,    100_000),
    "3": (100_001,   1_000_000),
    "4": (1_000_000, 1_000_000),
}


def fmv_midpoint(code):
    band = FMV_BANDS.get((code or "").strip())
    return None if band is None else (band[0] + band[1]) / 2


def load_roster():
    """Elected officials to score, in ballot order. See roster.csv for sourcing."""
    with open(ROSTER_CSV, newline="") as f:
        roster = list(csv.DictReader(f))
    for i, r in enumerate(roster):
        r["order"] = i
    return {r["filer_name"]: r for r in roster}


def latest_filings(rows):
    """Each filer's most recent filing, as {filer_name: ((date, n_a1, id), rows)}.

    Where two filings share a date (a filer covering several roles files once per
    role), keep whichever discloses more Schedule A1 rows. Callers should have
    already dropped superseded filings.
    """
    by_filing = defaultdict(list)
    for r in rows:
        by_filing[(r["filer_name"], r["filing_date"], r["filing_id"])].append(r)

    latest = {}
    for (name, fdate, fid), group in by_filing.items():
        n_a1 = sum(1 for r in group if r["schedule_code"] == "ScheduleA1")
        key = (fdate, n_a1, fid)
        if name not in latest or key > latest[name][0]:
            latest[name] = (key, group)
    return latest


def ensure_dataset():
    if os.path.exists(SEI_CSV) and os.path.getsize(SEI_CSV) > 1_000_000:
        return
    os.makedirs(DATA, exist_ok=True)
    print(f"downloading dataset -> {SEI_CSV}", file=sys.stderr)
    req = urllib.request.Request(SEI_URL, headers={"User-Agent": "sf-form700-investors/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(SEI_CSV, "wb") as f:
        f.write(r.read())


def main():
    ensure_dataset()
    roster = load_roster()
    csv.field_size_limit(10 ** 7)
    with open(SEI_CSV, newline="") as f:
        rows = [r for r in csv.DictReader(f) if r["filer_name"] in roster]

    # Drop superseded filings (amendments replace the original).
    rows = [r for r in rows if r["is_superseded"] == "false"]

    latest = latest_filings(rows)

    out, summary = [], []
    for name, info in sorted(roster.items(), key=lambda kv: kv[1]["order"]):
        base = {"filer_name": name, "office": info["office"],
                "body": info["body"], "seat": info["seat"], "order": info["order"]}
        if name not in latest:
            summary.append({**base, "n_holdings": 0, "status": "no filings found"})
            continue
        (fdate, _, fid), group = latest[name]
        meta = group[0]
        a1 = [r for r in group if r["schedule_code"] == "ScheduleA1"]

        seen = set()
        for r in a1:
            entity = (r["entity_or_source"] or "").strip()
            if not entity or entity.lower() in seen:
                continue
            seen.add(entity.lower())
            out.append({
                **base,
                "filing_id": fid,
                "filing_date": fdate[:10],
                "period_start": meta["period_start"][:10],
                "period_end": meta["period_end"][:10],
                "entity_or_source": entity,
                "description": (r["description"] or "").strip(),
                "fmv_code": r["fair_market_value_code"],
                "fmv_midpoint": fmv_midpoint(r["fair_market_value_code"]),
                "date_acquired": (r["date_acquired"] or "")[:10],
                "date_disposed": (r["date_disposed"] or "")[:10],
            })
        summary.append({
            **base,
            "filing_id": fid, "filing_date": fdate[:10],
            "period": f'{meta["period_start"][:10]}..{meta["period_end"][:10]}',
            "n_holdings": len(seen),
            "status": "ok" if seen else "no stock holdings disclosed",
        })

    os.makedirs(DATA, exist_ok=True)
    with open(os.path.join(DATA, PREFIX + "holdings.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    with open(os.path.join(DATA, PREFIX + "filing_summary.json"), "w") as f:
        json.dump(summary, f, indent=2)

    print(f"{len(out)} holdings across "
          f"{len({r['filer_name'] for r in out})} of {len(roster)} officials\n")
    body = None
    for s in summary:
        if s["body"] != body:
            body = s["body"]
            print(f"  -- {body}")
        print(f'     {s["seat"]:<16} {s["filer_name"]:<22} {s.get("n_holdings", 0):>3} holdings  '
              f'{s.get("filing_date", "-"):<12} {s["status"]}')


if __name__ == "__main__":
    main()
