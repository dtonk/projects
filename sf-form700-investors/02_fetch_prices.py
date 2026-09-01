"""Fetch dividend-adjusted daily price history for every mapped ticker.

Uses Yahoo Finance's chart endpoint (no API key) via curl -- this machine's
Python has no CA bundle, so urllib fails SSL verification. Writes data/prices.json as
{ticker: {"YYYY-MM-DD": adjusted_close, ...}} plus SPY as the benchmark.
"""
import csv, json, os, shutil, subprocess, sys, time
from datetime import datetime, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
OUT = os.path.join(DATA, "prices.json")
BENCHMARK = "SPY"
URL = ("https://query1.finance.yahoo.com/v8/finance/chart/{t}"
       "?range=6y&interval=1d&events=div%2Csplit")


def fetch(ticker, tries=3):
    url = URL.format(t=ticker.replace("^", "%5E"))
    for attempt in range(tries):
        proc = subprocess.run(
            ["curl", "-sL", "--max-time", "30", "-H", "User-Agent: Mozilla/5.0", url],
            capture_output=True)
        if proc.returncode != 0 or not proc.stdout:
            if attempt < tries - 1:
                time.sleep(2 * (attempt + 1))
                continue
            return None, f"curl exit {proc.returncode}"
        try:
            payload = json.loads(proc.stdout)
        except json.JSONDecodeError:
            if attempt < tries - 1:
                time.sleep(3 * (attempt + 1))
                continue
            return None, "non-JSON response (throttled?)"
        chart = (payload or {}).get("chart") or {}
        if chart.get("error"):
            return None, str(chart["error"].get("description", chart["error"]))[:60]
        result = chart.get("result")
        if not result:
            return None, "no result"
        res = result[0]
        stamps = res.get("timestamp") or []
        ind = res.get("indicators") or {}
        # Prefer dividend-adjusted closes; some instruments (certain mutual
        # funds) only carry a raw close, which makes their return price-only.
        adj = ind.get("adjclose") or []
        series_vals = None
        if adj and isinstance(adj[0], dict) and adj[0].get("adjclose"):
            series_vals = adj[0]["adjclose"]
        else:
            quote = ind.get("quote") or []
            if quote and isinstance(quote[0], dict):
                series_vals = quote[0].get("close")
        if not series_vals:
            return None, "no price series in response"
        series = {}
        for ts, val in zip(stamps, series_vals):
            if val is None:
                continue
            day = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d")
            series[day] = round(float(val), 6)
        if not series:
            return None, "empty series"
        return series, None
    return None, "exhausted retries"


def fetch_safe(ticker):
    try:
        return fetch(ticker)
    except Exception as e:  # noqa: BLE001 - never let one ticker abort the run
        return None, f"parse error: {type(e).__name__} {e}"[:70]


def main():
    if not shutil.which("curl"):
        sys.exit("curl is required")
    with open(os.path.join(HERE, "ticker_map.csv"), newline="") as f:
        tickers = sorted({r["ticker"].strip() for r in csv.DictReader(f)
                          if r["include"] == "yes" and r["ticker"].strip()})
    tickers.append(BENCHMARK)

    prices, failures = {}, []
    for i, t in enumerate(tickers, 1):
        series, err = fetch_safe(t)
        if err:
            failures.append((t, err))
            print(f"  [{i}/{len(tickers)}] {t:<8} FAILED: {err}", file=sys.stderr)
        else:
            prices[t] = series
            days = sorted(series)
            print(f"  [{i}/{len(tickers)}] {t:<8} {len(series):>5} days  "
                  f"{days[0]} -> {days[-1]}  last={series[days[-1]]}", file=sys.stderr)
        time.sleep(0.4)

    os.makedirs(DATA, exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(prices, f)
    print(f"\nwrote {len(prices)} tickers to {OUT}")
    if failures:
        print("FAILURES (fix ticker_map.csv):")
        for t, e in failures:
            print(f"   {t}: {e}")


if __name__ == "__main__":
    main()
