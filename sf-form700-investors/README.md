# SF Supervisors: Form 700 Investor Scorecard

Ranks the sitting San Francisco Board of Supervisors by the performance of the
stock portfolios they disclose on their Form 700 statements of economic interest.

## Pipeline

```
python3 01_extract_holdings.py   # dataset + roster.csv -> data/holdings.csv
#         review ticker_map.csv  <- the one file that needs human eyes
python3 02_fetch_prices.py       # tickers -> data/prices.json  (Yahoo, no API key)
python3 03_analyze.py            # -> data/results.json + printed leaderboard
python3 04_report.py             # -> report.html
python3 05_export_csv.py         # -> data/officials_returns.csv, data/holdings_returns.csv
python3 06_export_nonstock.py    # -> data/nonstock_disclosures.csv
```

Who gets scored is a roster CSV, not code. Two rosters ship:

```
python3 01_extract_holdings.py            # elected officials  -> report.html
SF700_ROSTER=roster_appointed.csv SF700_PREFIX=appointed_ python3 01_extract_holdings.py
```

`SF700_ROSTER` picks the roster, `SF700_PREFIX` namespaces every output, so the two
analyses live side by side and share one price cache. Every stage honours both.

`07_suggest_tickers.py` drafts mappings for unmapped entity strings into
`data/*ticker_suggestions.csv` with a confidence grade. **It never writes
`ticker_map.csv`** — a human promotes rows. Measured accuracy on the appointed run:
70 high / 25 medium / 22 low / 12 unresolved out of 129, and review still caught
real errors at *high* confidence ("General Electric Co" → Portland General Electric;
"Goldman Sachs" → Goldman Sachs BDC). Always review before promoting.

## Outputs

| File | What's in it |
|---|---|
| `data/officials_returns.csv` | One row per elected official: 1y and 5y return, return vs the S&P 500, nominal gain, coverage, best and worst holding. Row 1 is the SPY benchmark. Officials with nothing to score are kept, with a `status` saying why. |
| `data/holdings_returns.csv` | One row per disclosed holding: ticker, value band and midpoint, share of portfolio, 1y/5y return and dollar gain, and a reason on every unpriced row. |
| `data/nonstock_disclosures.csv` | For the officials with no Schedule A1 stock at all: everything else they *did* disclose — real property, business entities and trusts, outside income, gifts, travel. Shows that "no stock" is not "no assets". |
| `report.html` / `appointed_report.html` | The published scorecards. |

## Data source

[Investment Holdings by San Francisco Officials (Form 700)](https://danalytics.reliquery.net/datasets/jexvgs/netfile-sei-holdings),
sourced from the SF Ethics Commission's NetFile site. `01_extract_holdings.py`
downloads it on first run and caches it under `data/`.

## Method and its assumptions

Every one of these is a deliberate simplification. Read them before quoting a number.

**Rosters.** *Elected:* all 32 elected officials of San Francisco — Mayor, City Attorney,
District Attorney, Public Defender, Assessor-Recorder, Treasurer, Sheriff, 11
supervisors, 7 Board of Education commissioners, 7 City College trustees — verified
against `sfbos.org`, `sfusd.edu` and `ccsf.edu`. This matters: the dataset's
`department` field concatenates every role a filer has ever held, so "Board of
Supervisors" also matches people who left years ago, and department matching alone
sweeps in departmental staff. Note that Joel Engardio (D4) was recalled in September
2025 and replaced by Alan Wong. BART directors and Superior Court judges are elected
by San Franciscans but file outside SF Ethics' NetFile system, so they are absent
from this dataset entirely.

*Appointed:* 32 department heads. No authoritative public roster of SF department
heads exists, so this one is derived from the position each filer swore to on their
own Form 700 and then spot-checked; `roster_appointed.csv` carries a `confidence`
column (7 externally verified, 25 self-reported). This is the weakest link in the
appointed analysis — see `EXCLUSIONS.md` for claimants who were removed, including
two who between them would have contributed 20 holdings they had no standing to.

**Which filing.** Each supervisor's most recent non-superseded filing, whenever it
happens to be. Filing dates span 2024-05 to 2026-06, so these portfolios are *not*
all measured from the same starting line.

**Which holdings.** Schedule A1 ("Investments — Stocks, etc.") only, narrowed to
things with a public price: listed equities and ETFs. Private companies, PE/hedge/
credit funds, real estate funds, and crypto are excluded and reported as coverage
gaps rather than silently dropped.

**Position size.** Form 700 discloses *bands*, not dollars. Each holding is valued
at its band midpoint: code 1 = $6,000, code 2 = $55,000, code 3 = $550,000. Code 4
is open-ended ("Over $1,000,000") and is valued at its $1,000,000 floor — the
conservative choice, which understates the largest portfolios.

**Returns.** Dividend-adjusted total return over trailing 1-year and 5-year windows,
benchmarked against SPY. Acquisition and disposal dates are ignored by design: the
disclosed position is assumed to have been held, unchanged, for the whole window.
So nominal gain reads as *"if you held this much of it for the window, this is what
it made"* — it is not a claim about what anyone actually earned.

**Missing history.** A holding with no price data covering a window (recent IPO,
delisting) is dropped from that window and the remaining weights are renormalized.
Coverage is reported per person.

## Known limits

- **Bands are coarse.** A code 3 holding is anywhere from $100k to $1M, all valued
  at $550k. Rankings by nominal dollars are directionally useful at best.
- **Small portfolios dominate the extremes.** Several supervisors disclose exactly
  one stock, so their "portfolio return" is one company's return. Always read the
  holdings count alongside the rank.
- **Form 700 covers spouses and dependent children**, so a portfolio is not
  necessarily the supervisor's own picks.
- **Diversified mutual funds are not reportable** on Form 700, so what you see is
  skewed toward individual stocks and sector funds. This is a disclosure artifact,
  not a portfolio.
- **Non-disclosure is not the same as owning nothing** — it can also mean holdings
  sit below the reporting threshold or in exempt funds.
