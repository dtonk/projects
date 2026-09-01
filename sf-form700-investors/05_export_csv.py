"""Export the analysis to two flat CSVs for spreadsheet use.

  data/officials_returns.csv  one row per elected official + an S&P 500 benchmark row
  data/holdings_returns.csv   one row per disclosed holding, with its own returns
"""
import csv, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PREFIX = os.environ.get("SF700_PREFIX", "")

FMV_BAND = {
    "1": "$2,000 - $10,000",
    "2": "$10,001 - $100,000",
    "3": "$100,001 - $1,000,000",
    "4": "Over $1,000,000",
}


def r2(v):
    """Percent, 2dp, as a plain number so spreadsheets treat it as numeric."""
    return "" if v is None else round(v * 100, 2)


def d0(v):
    return "" if v is None else round(v)


def display_name(filer_name):
    last, _, first = filer_name.partition(",")
    return f"{first.strip()} {last.strip()}".strip() if first.strip() else last.strip()


def main():
    with open(os.path.join(DATA, PREFIX + "results.json")) as f:
        res = json.load(f)
    with open(os.path.join(DATA, PREFIX + "filing_summary.json")) as f:
        summary = json.load(f)

    scored = {s["filer_name"]: s for s in res["supervisors"]}
    bench = res["benchmark_returns"]
    as_of = res["as_of"]

    # ---------- 1. one row per official ----------
    cols = ["rank_1y", "rank_5y", "official", "office", "body", "seat", "status",
            "filing_date", "n_holdings_disclosed", "n_holdings_priced",
            "disclosed_value_usd", "priced_value_usd",
            "return_1y_pct", "vs_sp500_1y_pct", "gain_1y_usd", "coverage_1y_pct",
            "return_5y_pct", "vs_sp500_5y_pct", "gain_5y_usd", "coverage_5y_pct",
            "best_1y_ticker", "best_1y_pct", "worst_1y_ticker", "worst_1y_pct",
            "best_5y_ticker", "best_5y_pct", "worst_5y_ticker", "worst_5y_pct",
            "priced_as_of"]

    def rank_map(label):
        ranked = sorted([s for s in res["supervisors"] if s["windows"].get(label)],
                        key=lambda s: -s["windows"][label]["pct_return"])
        return {s["filer_name"]: i for i, s in enumerate(ranked, 1)}

    r1, r5 = rank_map("1y"), rank_map("5y")

    rows = [{
        "rank_1y": "", "rank_5y": "", "official": "S&P 500 (SPY total return)",
        "office": "BENCHMARK", "body": "BENCHMARK", "seat": "", "status": "benchmark",
        "return_1y_pct": r2(bench["1y"]), "vs_sp500_1y_pct": 0.0,
        "return_5y_pct": r2(bench["5y"]), "vs_sp500_5y_pct": 0.0,
        "priced_as_of": as_of,
    }]

    for s in summary:
        sc = scored.get(s["filer_name"])
        w1 = (sc or {}).get("windows", {}).get("1y")
        w5 = (sc or {}).get("windows", {}).get("5y")
        row = {
            "rank_1y": r1.get(s["filer_name"], ""),
            "rank_5y": r5.get(s["filer_name"], ""),
            "official": display_name(s["filer_name"]),
            "office": s["office"], "body": s["body"], "seat": s["seat"],
            "filing_date": s.get("filing_date", ""),
            "n_holdings_disclosed": s.get("n_holdings", 0),
            "n_holdings_priced": (sc or {}).get("n_priced", 0),
            "disclosed_value_usd": d0((sc or {}).get("disclosed_value")),
            "priced_value_usd": d0(w1["valued_base"] if w1 else None),
            "priced_as_of": as_of,
        }
        if s.get("n_holdings", 0) == 0:
            row["status"] = "no stock disclosed"
        elif not w1 and not w5:
            row["status"] = "disclosed stock, none priceable"
        elif not w5:
            row["status"] = "scored (no 5y history)"
        else:
            row["status"] = "scored"
        for label, w in (("1y", w1), ("5y", w5)):
            if not w:
                continue
            row[f"return_{label}_pct"] = r2(w["pct_return"])
            row[f"vs_sp500_{label}_pct"] = r2(w["alpha"])
            row[f"gain_{label}_usd"] = d0(w["nominal_gain"])
            row[f"coverage_{label}_pct"] = r2(w["coverage_pct"])
            row[f"best_{label}_ticker"] = w["best"]["ticker"]
            row[f"best_{label}_pct"] = r2(w["best"]["ret"])
            row[f"worst_{label}_ticker"] = w["worst"]["ticker"]
            row[f"worst_{label}_pct"] = r2(w["worst"]["ret"])
        rows.append(row)

    # benchmark first, then scored officials by 1y rank, then everyone else
    rows[1:] = sorted(rows[1:], key=lambda r: (r["rank_1y"] == "", r["rank_1y"] or 0,
                                               -(r["n_holdings_disclosed"] or 0)))
    out1 = os.path.join(DATA, PREFIX + "officials_returns.csv")
    with open(out1, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        w.writerows(rows)

    # ---------- 2. one row per holding ----------
    hcols = ["official", "office", "body", "seat", "filing_date",
             "entity_as_disclosed", "ticker", "asset_type", "priced",
             "fmv_code", "fmv_band", "value_midpoint_usd", "pct_of_portfolio",
             "return_1y_pct", "return_5y_pct", "gain_1y_usd", "gain_5y_usd",
             "last_price_date", "note"]
    hrows = []
    for s in sorted(res["supervisors"], key=lambda s: s["order"]):
        total = s["disclosed_value"] or 0
        for h in sorted(s["holdings"], key=lambda h: -(h["midpoint"] or 0)):
            mid = h["midpoint"]
            ret1, ret5 = h["returns"].get("1y"), h["returns"].get("5y")
            hrows.append({
                "official": display_name(s["filer_name"]), "office": s["office"],
                "body": s["body"], "seat": s["seat"], "filing_date": s["filing_date"],
                "entity_as_disclosed": h["entity"], "ticker": h["ticker"],
                "asset_type": h["asset_type"], "priced": "yes" if h["included"] else "no",
                "fmv_code": h["fmv_code"], "fmv_band": FMV_BAND.get(h["fmv_code"], ""),
                "value_midpoint_usd": d0(mid),
                "pct_of_portfolio": round(mid / total * 100, 2) if mid and total else "",
                "return_1y_pct": r2(ret1), "return_5y_pct": r2(ret5),
                "gain_1y_usd": d0(mid * ret1) if (mid and ret1 is not None) else "",
                "gain_5y_usd": d0(mid * ret5) if (mid and ret5 is not None) else "",
                "last_price_date": h.get("last_price_date", ""),
                "note": h["note"],
            })
    out2 = os.path.join(DATA, PREFIX + "holdings_returns.csv")
    with open(out2, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=hcols, extrasaction="ignore")
        w.writeheader()
        w.writerows(hrows)

    print(f"{out1}\n   {len(rows)} rows (1 benchmark + {len(rows) - 1} officials)")
    print(f"{out2}\n   {len(hrows)} holdings, "
          f"{sum(1 for h in hrows if h['priced'] == 'yes')} priced")


if __name__ == "__main__":
    main()
