"""What the officials who disclosed NO stock did disclose instead.

Form 700 has six schedules; 01_extract_holdings.py only scores Schedule A1
(stocks). An official with no A1 rows has not necessarily disclosed nothing --
they may hold real property, business interests, outside income, gifts or travel.
This pulls every non-A1 row from those officials' most recent filings.

  -> data/nonstock_disclosures.csv
"""
import csv, importlib, json, os

extract = importlib.import_module("01_extract_holdings")
HERE, DATA = extract.HERE, extract.DATA
OUT = os.path.join(DATA, "nonstock_disclosures.csv")

SCHEDULES = {
    "ScheduleA1": "Investments (stocks)",
    "ScheduleA2": "Business entities / trusts",
    "ScheduleB": "Real property",
    "ScheduleC": "Income & loans",
    "ScheduleD": "Gifts",
    "ScheduleE": "Travel payments",
}
FMV_BAND = {"1": "$2,000 - $10,000", "2": "$10,001 - $100,000",
            "3": "$100,001 - $1,000,000", "4": "Over $1,000,000"}


def display_name(filer_name):
    """'Chiu, David' -> 'David Chiu'."""
    last, _, first = filer_name.partition(",")
    return f"{first.strip()} {last.strip()}".strip() if first.strip() else last.strip()


def main():
    extract.ensure_dataset()
    roster = extract.load_roster()
    csv.field_size_limit(10 ** 7)
    with open(extract.SEI_CSV, newline="") as f:
        rows = [r for r in csv.DictReader(f)
                if r["filer_name"] in roster and r["is_superseded"] == "false"]

    latest = extract.latest_filings(rows)

    with open(os.path.join(DATA, "filing_summary.json")) as f:
        summary = json.load(f)
    targets = [s for s in summary if s.get("n_holdings", 0) == 0]

    out, tally = [], []
    for s in targets:
        name = s["filer_name"]
        entry = latest.get(name)
        group = entry[1] if entry else []
        counts = {}
        for r in sorted(group, key=lambda r: (r["schedule_code"],
                                              -(extract.fmv_midpoint(
                                                  r["fair_market_value_code"]) or 0))):
            code = r["schedule_code"]
            counts[code] = counts.get(code, 0) + 1
            mid = extract.fmv_midpoint(r["fair_market_value_code"])
            out.append({
                "official": display_name(name),
                "office": s["office"], "body": s["body"], "seat": s["seat"],
                "filing_date": s.get("filing_date", ""),
                "period": f'{r["period_start"][:10]}..{r["period_end"][:10]}',
                "schedule_code": code,
                "schedule": SCHEDULES.get(code, r["schedule_name"]),
                "entity_or_source": (r["entity_or_source"] or "").strip(),
                "description": (r["description"] or "").strip(),
                "location_city": (r["location_city"] or "").strip(),
                "fmv_code": r["fair_market_value_code"],
                "fmv_band": FMV_BAND.get(r["fair_market_value_code"], ""),
                "value_midpoint_usd": "" if mid is None else round(mid),
                "amount_usd": (r["amount_usd"] or "").strip(),
                "date_acquired": (r["date_acquired"] or "")[:10],
                "date_disposed": (r["date_disposed"] or "")[:10],
            })
        tally.append((s, counts, len(group)))

    with open(OUT, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)

    print(f"{len(out)} disclosures across {len(targets)} officials with no stock\n")
    body = None
    for s, counts, n in sorted(tally, key=lambda t: (t[0]["order"])):
        if s["body"] != body:
            body = s["body"]
            print(f"  -- {body}")
        detail = ", ".join(f"{SCHEDULES.get(c, c)} x{n_}"
                           for c, n_ in sorted(counts.items())) or "nothing disclosed at all"
        print(f'     {s["seat"]:<16} {s["filer_name"]:<22} {n:>3}  {detail}')
    print(f"\n-> {OUT}")


if __name__ == "__main__":
    main()
