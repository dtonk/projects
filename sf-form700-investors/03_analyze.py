"""Score each supervisor's disclosed stock portfolio over 1y and 5y horizons.

Method
------
Form 700 discloses value *bands*, not dollars, so each holding is valued at its
band midpoint (the open-ended "Over $1,000,000" band is valued at its $1,000,000
floor). We assume the disclosed position was held, unchanged, for the whole
lookback window -- acquisition and disposal dates are ignored by design.

Nominal gain therefore reads as "if you held this much of it for the window,
this is what it made", i.e. gain = midpoint * total_return.

Returns are dividend-adjusted total returns. Holdings with no price history
covering a window are dropped from that window and the remaining weights are
renormalized; coverage is reported so you can see how much was excluded.
"""
import csv, json, os
from datetime import date, timedelta

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PREFIX = os.environ.get("SF700_PREFIX", "")
BENCHMARK = "SPY"
STALE_DAYS = 45  # a last-price older than this means the ticker stopped trading


def price_on(series_sorted, target):
    """Last close on or before `target` (ISO string). None if series starts later."""
    lo, hi, found = 0, len(series_sorted) - 1, None
    while lo <= hi:
        mid = (lo + hi) // 2
        if series_sorted[mid][0] <= target:
            found = series_sorted[mid]
            lo = mid + 1
        else:
            hi = mid - 1
    return found


def main():
    with open(os.path.join(DATA, PREFIX + "holdings.csv"), newline="") as f:
        holdings = list(csv.DictReader(f))
    with open(os.path.join(HERE, "ticker_map.csv"), newline="") as f:
        tmap = {r["entity_or_source"]: r for r in csv.DictReader(f)}
    with open(os.path.join(DATA, "prices.json")) as f:
        prices = {t: sorted(s.items()) for t, s in json.load(f).items()}

    today = max(prices[BENCHMARK])[0]
    windows = {
        "1y": (date.fromisoformat(today) - timedelta(days=365)).isoformat(),
        "5y": (date.fromisoformat(today) - timedelta(days=365 * 5)).isoformat(),
    }

    bench = {}
    for label, start in windows.items():
        p0, p1 = price_on(prices[BENCHMARK], start), price_on(prices[BENCHMARK], today)
        bench[label] = p1[1] / p0[1] - 1

    people = {}
    for h in holdings:
        people.setdefault(h["filer_name"], {
            "filer_name": h["filer_name"], "office": h["office"],
            "body": h["body"], "seat": h["seat"], "order": int(h["order"]),
            "filing_date": h["filing_date"], "period": f'{h["period_start"]}..{h["period_end"]}',
            "holdings": [],
        })["holdings"].append(h)

    results = []
    for name, p in people.items():
        rows = []
        for h in p["holdings"]:
            m = tmap.get(h["entity_or_source"], {})
            rec = {
                "entity": h["entity_or_source"],
                "ticker": m.get("ticker", ""),
                "asset_type": m.get("asset_type", "unmapped"),
                "included": m.get("include") == "yes",
                "note": m.get("note", ""),
                "fmv_code": h["fmv_code"],
                "midpoint": float(h["fmv_midpoint"]) if h["fmv_midpoint"] else None,
                "returns": {},
            }
            series = prices.get(rec["ticker"]) if rec["included"] else None
            if series:
                last_day, last_px = series[-1]
                rec["last_price_date"] = last_day
                rec["stale"] = (date.fromisoformat(today) - date.fromisoformat(last_day)).days > STALE_DAYS
                for label, start in windows.items():
                    p0 = price_on(series, start)
                    # require the series to actually begin at/before the window start
                    if p0 and series[0][0] <= start:
                        rec["returns"][label] = last_px / p0[1] - 1
            elif rec["included"]:
                rec["included"] = False
                rec["note"] = (rec["note"] + " | NO PRICE DATA").strip(" |")
            rows.append(rec)

        person = dict(p)
        person["holdings"] = rows
        person["n_disclosed"] = len(rows)
        person["n_priced"] = sum(1 for r in rows if r["included"])
        person["disclosed_value"] = sum(r["midpoint"] or 0 for r in rows)
        person["windows"] = {}

        for label in windows:
            covered = [r for r in rows if r["included"] and label in r["returns"] and r["midpoint"]]
            if not covered:
                person["windows"][label] = None
                continue
            base = sum(r["midpoint"] for r in covered)
            pct = sum(r["midpoint"] / base * r["returns"][label] for r in covered)
            gain = sum(r["midpoint"] * r["returns"][label] for r in covered)
            ranked = sorted(covered, key=lambda r: r["returns"][label])
            person["windows"][label] = {
                "pct_return": pct,
                "nominal_gain": gain,
                "valued_base": base,
                "n_holdings": len(covered),
                "coverage_pct": base / person["disclosed_value"] if person["disclosed_value"] else 0,
                "benchmark": bench[label],
                "alpha": pct - bench[label],
                "best": {"entity": ranked[-1]["entity"], "ticker": ranked[-1]["ticker"],
                         "ret": ranked[-1]["returns"][label]},
                "worst": {"entity": ranked[0]["entity"], "ticker": ranked[0]["ticker"],
                          "ret": ranked[0]["returns"][label]},
            }
        results.append(person)

    out = {"as_of": today, "windows": windows, "benchmark_ticker": BENCHMARK,
           "benchmark_returns": bench, "supervisors": results}
    with open(os.path.join(DATA, PREFIX + "results.json"), "w") as f:
        json.dump(out, f, indent=2)

    pct = lambda v: f"{v * 100:+.1f}%"
    usd = lambda v: f"${v:,.0f}"
    for label in ("1y", "5y"):
        ranked = sorted([r for r in results if r["windows"].get(label)],
                        key=lambda r: -r["windows"][label]["pct_return"])
        print(f"\n{'=' * 96}\n{label.upper()} TOTAL RETURN  (as of {today};"
              f" {BENCHMARK} {pct(bench[label])})\n{'=' * 96}")
        print(f"{'#':<3}{'Official':<22}{'Seat':<12}{'Return':>9}{'vs SPY':>9}"
              f"{'Gain':>13}{'Valued':>13}{'N':>4}  Best / Worst")
        for i, r in enumerate(ranked, 1):
            w = r["windows"][label]
            print(f"{i:<3}{r['filer_name']:<22}{r['seat']:<12}{pct(w['pct_return']):>9}"
                  f"{pct(w['alpha']):>9}{usd(w['nominal_gain']):>13}{usd(w['valued_base']):>13}"
                  f"{w['n_holdings']:>4}  {w['best']['ticker']} {pct(w['best']['ret'])}"
                  f" / {w['worst']['ticker']} {pct(w['worst']['ret'])}")
    print()
    for r in sorted(results, key=lambda r: r["order"]):
        skipped = [h for h in r["holdings"] if not h["included"]]
        if skipped:
            print(f"  {r['seat']:<16} {r['filer_name']:<22} {len(skipped)}/{r['n_disclosed']} "
                  f"unpriceable ({', '.join(sorted({h['asset_type'] for h in skipped}))})")


if __name__ == "__main__":
    main()
