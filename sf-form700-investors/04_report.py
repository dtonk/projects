"""Render data/results.json into a self-contained report.html."""
import html, json, os

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PREFIX = os.environ.get("SF700_PREFIX", "")
OUT = os.path.join(HERE, (PREFIX or "") + "report.html")
BAR_CAP = 1.5  # bars clamp here; the numeral always carries the true value

# Copy differs by roster: elected officials vs appointed department heads.
COPY = {
    "": {
        "title": "Supervisor Stock Scorecard",
        "eyebrow": "Form 700 · San Francisco elected officials",
        "who": "all {n} people San Francisco elects",
        "detail": ("the Mayor, the six other citywide officers, the Board of Supervisors, "
                   "the school board and the City College board"),
        "roster_note": ("The Mayor, City Attorney, District Attorney, Public Defender, "
                        "Assessor-Recorder, Treasurer, Sheriff, 11 supervisors, 7 school board "
                        "commissioners and 7 City College trustees, verified against sfbos.org, "
                        "sfusd.edu and ccsf.edu. BART directors and Superior Court judges are "
                        "elected by San Franciscans but file elsewhere."),
        "bodies": ["Citywide", "Board of Supervisors", "Board of Education",
                   "Community College Board"],
    },
    "appointed_": {
        "title": "Department Head Scorecard",
        "eyebrow": "Form 700 · San Francisco department heads",
        "who": "the {n} appointed officials who run San Francisco",
        "detail": ("the people who run the Airport, Public Works, the Police and Fire "
                   "departments, Public Health, the Library and two dozen more agencies — "
                   "nobody votes for any of them"),
        "roster_note": ("Nobody publishes a roster of San Francisco department heads, so this "
                        "one is built from the position each filer swore to on their own Form "
                        "700, then spot-checked. Seven are externally verified; the rest are "
                        "self-reported. Claimants who turned out to be interim, deputy or "
                        "retired were removed — see EXCLUSIONS.md."),
        "bodies": ["Housing & Homelessness", "Infrastructure & Transport",
                   "Public Safety & Justice", "Health & Human Services",
                   "Administration", "Culture & Education"],
    },
}
C = COPY[os.environ.get("SF700_PREFIX", "")]

e = html.escape


def display_name(filer_name):
    """'Sherrill, Stephen' -> 'Stephen Sherrill' for reading, not sorting."""
    last, _, first = filer_name.partition(",")
    return f"{first.strip()} {last.strip()}".strip() if first.strip() else last.strip()

pct = lambda v: f"{v * 100:+.1f}%"
usd = lambda v: ("-$" if v < 0 else "$") + f"{abs(v):,.0f}"


BODY_CHIP = {
    "Board of Supervisors": lambda r: r["seat"],
    "Citywide": lambda r: r["seat"],
    "Board of Education": lambda r: "School Board",
    "Community College Board": lambda r: "CCSF Board",
}


def chip(r):
    return BODY_CHIP.get(r["body"], lambda x: x["body"])(r)


def bar(value, cap=BAR_CAP):
    """Diverging bar around a zero baseline. Returns (side, width%, overflow)."""
    over = abs(value) > cap
    w = min(abs(value), cap) / cap * 50
    return ("pos" if value >= 0 else "neg", w, over)


def leaderboard(sups, label, bench):
    ranked = sorted([s for s in sups if s["windows"].get(label)],
                    key=lambda s: -s["windows"][label]["pct_return"])
    bside, bw, _ = bar(bench)
    marker = 50 + bw if bench >= 0 else 50 - bw
    rows = []
    for i, s in enumerate(ranked, 1):
        w = s["windows"][label]
        side, width, over = bar(w["pct_return"])
        beat = w["alpha"] >= 0
        cov = w["coverage_pct"]
        cov_flag = ('<span class="flag" title="share of this portfolio\'s disclosed '
                    f'value that could be priced">{cov * 100:.0f}% priced</span>'
                    if cov < 0.8 else "")
        thin = ('<span class="flag" title="a one-holding portfolio is one company\'s '
                'return">single holding</span>' if w["n_holdings"] == 1 else "")
        rows.append(f'''
      <tr>
        <td class="rank">{i}</td>
        <td class="who"><span class="name">{e(display_name(s["filer_name"]))}</span>
          <span class="dist">{e(chip(s))}</span>{cov_flag}{thin}</td>
        <td class="plot">
          <div class="track" role="img" aria-label="{pct(w["pct_return"])} total return">
            <div class="zero"></div>
            <div class="bar {side}{" over" if over else ""}"
                 style="width:{width:.2f}%"></div>
          </div>
        </td>
        <td class="num ret {"pos" if w["pct_return"] >= 0 else "neg"}">{pct(w["pct_return"])}</td>
        <td class="num alpha {"pos" if beat else "neg"}">{pct(w["alpha"])}</td>
        <td class="num gain">{usd(w["nominal_gain"])}</td>
        <td class="num muted">{w["n_holdings"]}</td>
        <td class="picks">
          <span class="pick"><b class="pos">▲</b> <code>{e(w["best"]["ticker"])}</code>
            <span class="pv pos">{pct(w["best"]["ret"])}</span></span>
          <span class="pick"><b class="neg">▼</b> <code>{e(w["worst"]["ticker"])}</code>
            <span class="pv neg">{pct(w["worst"]["ret"])}</span></span>
        </td>
      </tr>''')
    return f'''
    <div class="board">
      <div class="board-head">
        <h3>{label.upper()} total return</h3>
        <p class="bench-note">S&amp;P 500 (SPY) returned <b>{pct(bench)}</b> over the same window.
          The dashed line marks it.</p>
      </div>
      <div class="scroll">
      <table>
        <thead>
          <tr>
            <th class="rank">#</th><th>Supervisor</th>
            <th class="plot"><div class="axis"><span>−150%</span><span>0</span><span>+150%</span></div></th>
            <th class="num">Return</th><th class="num">vs&nbsp;SPY</th>
            <th class="num">Nominal</th><th class="num">Held</th><th>Best / worst</th>
          </tr>
        </thead>
        <tbody style="--spy:{marker:.2f}%">{"".join(rows)}</tbody>
      </table>
      </div>
    </div>'''


def detail(s):
    priced = [h for h in s["holdings"] if h["included"]]
    skipped = [h for h in s["holdings"] if not h["included"]]
    if priced:
        items = "".join(
            f'''<li><code>{e(h["ticker"])}</code>
              <span class="ent">{e(h["entity"])}</span>
              <span class="mid">{usd(h["midpoint"])}</span>
              <span class="r {"pos" if h["returns"].get("1y", 0) >= 0 else "neg"}">
                {pct(h["returns"]["1y"]) if "1y" in h["returns"] else "—"}</span>
              <span class="r {"pos" if h["returns"].get("5y", 0) >= 0 else "neg"}">
                {pct(h["returns"]["5y"]) if "5y" in h["returns"] else "—"}</span></li>'''
            for h in sorted(priced, key=lambda x: -(x["midpoint"] or 0)))
        body = f'''<ol class="hl"><li class="hl-head"><code>Ticker</code>
            <span class="ent">Holding</span><span class="mid">Value</span>
            <span class="r">1y</span><span class="r">5y</span></li>{items}</ol>'''
    else:
        body = '<p class="none">No priceable stock holdings in this filing.</p>'
    if skipped:
        body += ('<p class="skipped"><b>Not priced:</b> ' + ", ".join(
            f'{e(h["entity"])} <i>({e(h["asset_type"].replace("_", " "))})</i>'
            for h in skipped) + "</p>")
    return f'''
      <article class="card">
        <header>
          <h4>{e(display_name(s["filer_name"]))}<span class="dist">{e(chip(s))}</span></h4>
          <p class="meta">Filed {e(s["filing_date"])} · {s["n_priced"]} of {s["n_disclosed"]}
            holdings priced · {usd(s["disclosed_value"])} disclosed</p>
        </header>
        {body}
      </article>'''


def main():
    with open(os.path.join(DATA, PREFIX + "results.json")) as f:
        d = json.load(f)
    with open(os.path.join(DATA, PREFIX + "filing_summary.json")) as f:
        summary = json.load(f)

    sups = d["supervisors"]
    bench = d["benchmark_returns"]
    no_stock = [s for s in summary if s.get("n_holdings", 0) == 0]
    n_roster = len(summary)
    n_silent = len(no_stock)
    beat_1y = sum(1 for s in sups if (s["windows"].get("1y") or {}).get("alpha", -1) > 0)
    n_1y = sum(1 for s in sups if s["windows"].get("1y"))
    beat_5y = sum(1 for s in sups if (s["windows"].get("5y") or {}).get("alpha", -1) > 0)
    n_5y = sum(1 for s in sups if s["windows"].get("5y"))

    groups = []
    for body in C["bodies"]:
        members = sorted([s for s in sups if s["body"] == body], key=lambda s: s["order"])
        if members:
            groups.append(f'<h3 class="grp">{e(body)}</h3><div class="cards">'
                          + "".join(detail(m) for m in members) + "</div>")
    cards = "".join(groups)

    if os.environ.get("SF700_PREFIX", "") == "appointed_":
        callout = (
            'Two of the top three spots are the same bet: <b>Intel, up 268% in a year</b> '
            'during its turnaround. Tonia Lediju and Dennis Herrera each disclose exactly one '
            'stock, and it is Intel — so their "portfolio return" is one company\'s year, at '
            'very different stakes ($55,000 versus $550,000). At the other end, environment '
            'chief Tyrone Jue is last on a <b>MicroStrategy</b> position that fell 69% with '
            'bitcoin. The one genuinely diversified portfolio here belongs to Jennifer '
            'Johnston of the Civil Service Commission, with <b>64 holdings</b> — more than any '
            'elected official in the city.')
    else:
        callout = (
            'Several of these portfolios are a single stock, so their "return" is just one '
            'company\'s year. The top of the 1-year table is a case in point: City College '
            'trustee Ruth Ferguson ranks first almost entirely on <b>SanDisk, up roughly 35× '
            'in twelve months</b> during the AI-memory shortage — a real move, verified '
            'against a 52-week range of $43 to $2,354, but one held in her smallest '
            'disclosure band. The longest list of stock holdings among elected officials '
            'belongs to a <b>school board member</b>, not a politician: Jaime Huling Delaye '
            'discloses 55 positions. And the official with the most disclosed value, '
            'Supervisor Stephen Sherrill, keeps more than half of it in private companies '
            'and buyout funds with no public price, so only his listed slice is scored.')
    silent = {}
    for s_ in no_stock:
        silent.setdefault(s_["body"], []).append(
            f'{display_name(s_["filer_name"])} ({s_["seat"]})')
    nostock_names = "; ".join(f'<b>{e(b)}</b> — ' + ", ".join(e(n) for n in v)
                              for b, v in silent.items())

    css = """
:root{
  --ground:#EEF1F4; --panel:#F8F9FA; --line:#D3DAE1; --line-soft:#E3E8ED;
  --ink:#101B2D; --ink-2:#3C4A5C; --ink-3:#6B7683;
  --pos:#12876B; --neg:#C24A24; --accent:#8A6A1F;
  --shadow:0 1px 2px rgba(16,27,45,.06), 0 8px 24px -16px rgba(16,27,45,.30);
}
@media (prefers-color-scheme: dark){
  :root:not([data-theme="light"]){
    --ground:#0B121C; --panel:#111A26; --line:#27333F; --line-soft:#1A242F;
    --ink:#E6EBF0; --ink-2:#A8B4C1; --ink-3:#78848F;
    --pos:#34A585; --neg:#DE7048; --accent:#C7A24E;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -18px rgba(0,0,0,.8);
  }
}
:root[data-theme="dark"]{
  --ground:#0B121C; --panel:#111A26; --line:#27333F; --line-soft:#1A242F;
  --ink:#E6EBF0; --ink-2:#A8B4C1; --ink-3:#78848F;
  --pos:#34A585; --neg:#DE7048; --accent:#C7A24E;
  --shadow:0 1px 2px rgba(0,0,0,.4), 0 10px 28px -18px rgba(0,0,0,.8);
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font-family:"Source Serif 4",Georgia,serif; font-size:17px; line-height:1.6;
  -webkit-font-smoothing:antialiased;
}
.wrap{max-width:1080px; margin:0 auto; padding:clamp(28px,5vw,72px) clamp(18px,4vw,40px) 96px;
  display:flex; flex-direction:column; gap:clamp(40px,6vw,72px)}
h1,h2,h3,h4,.eyebrow,th,.dist,.flag,code,.num,.rank{
  font-family:Archivo,"Helvetica Neue",Arial,sans-serif}
.eyebrow{font-size:12px; letter-spacing:.14em; text-transform:uppercase;
  color:var(--ink-3); font-weight:600; margin:0 0 14px}
h1{font-size:clamp(34px,6vw,60px); line-height:1.02; letter-spacing:-.025em;
  font-weight:800; margin:0 0 20px; text-wrap:balance}
.lede{font-size:clamp(18px,2.2vw,21px); color:var(--ink-2); max-width:64ch; margin:0}
.lede b{color:var(--ink); font-weight:600}
h2{font-size:clamp(22px,3vw,29px); letter-spacing:-.015em; font-weight:700;
  margin:0 0 8px; text-wrap:balance}
.section>p.intro{color:var(--ink-2); max-width:66ch; margin:0 0 26px}
/* stat strip */
.stats{display:grid; gap:1px; background:var(--line);
  grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
  border:1px solid var(--line); border-radius:3px; overflow:hidden}
.stat{background:var(--panel); padding:16px 18px}
.stat .k{font-size:11px; letter-spacing:.1em; text-transform:uppercase;
  color:var(--ink-3); font-weight:600; font-family:Archivo,sans-serif}
.stat .v{font-family:"IBM Plex Mono",monospace; font-size:26px; font-weight:600;
  letter-spacing:-.02em; margin-top:4px; font-variant-numeric:tabular-nums}
.stat .v.pos{color:var(--pos)} .stat .v.neg{color:var(--neg)}
.stat .n{font-size:13px; color:var(--ink-3); line-height:1.35; margin-top:2px}
/* boards */
.board{background:var(--panel); border:1px solid var(--line); border-radius:3px;
  box-shadow:var(--shadow); overflow:hidden}
.board + .board{margin-top:28px}
.board-head{padding:20px 22px 16px; border-bottom:1px solid var(--line)}
.board-head h3{margin:0; font-size:19px; letter-spacing:.01em; font-weight:700}
.bench-note{margin:5px 0 0; font-size:14px; color:var(--ink-3)}
.bench-note b{color:var(--ink-2)}
.scroll{overflow-x:auto}
table{border-collapse:collapse; width:100%; min-width:880px}
th{font-size:10.5px; letter-spacing:.1em; text-transform:uppercase; font-weight:600;
  color:var(--ink-3); text-align:left; padding:11px 10px; border-bottom:1px solid var(--line);
  vertical-align:bottom}
td{padding:13px 10px; border-bottom:1px solid var(--line-soft); vertical-align:middle}
tbody tr:last-child td{border-bottom:none}
th:first-child,td:first-child{padding-left:22px} th:last-child,td:last-child{padding-right:22px}
.rank{width:34px; font-size:13px; color:var(--ink-3); font-variant-numeric:tabular-nums;
  font-weight:600}
.who{min-width:190px}
.name{font-family:Archivo,sans-serif; font-weight:600; font-size:15.5px}
.dist{font-family:"IBM Plex Mono",monospace; font-size:10.5px; color:var(--ink-3);
  border:1px solid var(--line); border-radius:2px; padding:1px 4px; margin-left:7px;
  vertical-align:1px}
.flag{display:inline-block; font-size:10px; letter-spacing:.04em; text-transform:uppercase;
  color:var(--accent); border:1px dashed currentColor; border-radius:2px;
  padding:1px 5px; margin-left:6px; font-weight:600; cursor:help}
/* diverging bar */
th.plot,td.plot{width:34%; min-width:210px}
.axis{display:flex; justify-content:space-between; font-family:"IBM Plex Mono",monospace;
  font-size:9.5px; letter-spacing:0; color:var(--ink-3); text-transform:none}
.track{position:relative; height:22px}
.track::before{content:""; position:absolute; inset:auto 0 -13px; height:1px;
  background:var(--line-soft)}
.zero{position:absolute; top:-1px; bottom:-1px; left:50%; width:1px; background:var(--line)}
tbody{position:relative}
td.plot .track::after{content:""; position:absolute; top:-2px; bottom:-2px; left:var(--spy);
  width:0; border-left:1px dashed var(--ink-3); opacity:.75}
.bar{position:absolute; top:3px; bottom:3px; border-radius:0}
.bar.pos{left:50%; background:var(--pos); border-radius:0 4px 4px 0; margin-left:1px}
.bar.neg{right:50%; background:var(--neg); border-radius:4px 0 0 4px; margin-right:1px}
.bar.over{clip-path:polygon(0 0,calc(100% - 7px) 0,100% 50%,calc(100% - 7px) 100%,0 100%)}
.bar.neg.over{clip-path:polygon(7px 0,100% 0,100% 100%,7px 100%,0 50%)}
.num{text-align:right; font-family:"IBM Plex Mono",monospace;
  font-variant-numeric:tabular-nums; font-size:14px; white-space:nowrap}
.ret{font-weight:600; font-size:15px} .alpha{font-size:13px}
.pos{color:var(--pos)} .neg{color:var(--neg)} .muted{color:var(--ink-3)}
.gain{color:var(--ink-2)}
.picks{white-space:nowrap; font-size:12px}
.pick{display:inline-flex; align-items:center; gap:4px}
.pick + .pick{margin-left:12px}
.pick b{font-size:9px} .pv{font-family:"IBM Plex Mono",monospace; font-size:11.5px}
code{font-family:"IBM Plex Mono",monospace; font-size:12px; background:var(--ground);
  border:1px solid var(--line-soft); border-radius:2px; padding:1px 4px; color:var(--ink-2)}
/* detail cards */
.grp{font-size:12px; letter-spacing:.12em; text-transform:uppercase; color:var(--ink-3);
  font-weight:600; margin:26px 0 12px; padding-bottom:7px; border-bottom:1px solid var(--line)}
.grp:first-of-type{margin-top:0}
.cards{display:grid; gap:16px; grid-template-columns:repeat(auto-fit,minmax(330px,1fr))}
.card{background:var(--panel); border:1px solid var(--line); border-radius:3px; padding:18px 20px}
.card h4{margin:0; font-size:16.5px; font-weight:700}
.card .meta{margin:3px 0 14px; font-size:12.5px; color:var(--ink-3);
  font-family:Archivo,sans-serif}
.hl{list-style:none; margin:0; padding:0; font-size:13.5px}
.hl li{display:grid; grid-template-columns:62px 1fr 70px 62px 66px; gap:8px;
  align-items:center; padding:6px 0; border-bottom:1px solid var(--line-soft)}
.hl li:last-child{border-bottom:none}
.hl-head{font-family:Archivo,sans-serif; font-size:10px; letter-spacing:.09em;
  text-transform:uppercase; color:var(--ink-3); font-weight:600}
.hl-head code{background:none; border:none; padding:0; color:inherit; font-size:10px;
  letter-spacing:.09em}
.ent{color:var(--ink-2); font-size:12.5px; overflow:hidden; text-overflow:ellipsis;
  white-space:nowrap}
.mid,.r{font-family:"IBM Plex Mono",monospace; font-size:12px; text-align:right;
  font-variant-numeric:tabular-nums}
.mid{color:var(--ink-3)}
.skipped{font-size:12.5px; color:var(--ink-3); margin:13px 0 0; padding-top:11px;
  border-top:1px solid var(--line); line-height:1.5}
.skipped b{font-family:Archivo,sans-serif; font-size:10px; letter-spacing:.09em;
  text-transform:uppercase; color:var(--ink-2)}
.none{color:var(--ink-3); font-size:14px; margin:0}
/* method */
.method{display:grid; gap:14px; grid-template-columns:repeat(auto-fit,minmax(270px,1fr))}
.m{border-left:2px solid var(--line); padding:2px 0 2px 15px}
.m h5{font-family:Archivo,sans-serif; margin:0 0 4px; font-size:13px; font-weight:700;
  letter-spacing:.01em}
.m p{margin:0; font-size:14px; color:var(--ink-2); line-height:1.55}
.callout{border:1px solid var(--accent); border-radius:3px; padding:16px 20px;
  background:color-mix(in srgb, var(--accent) 7%, var(--panel))}
.callout p{margin:0; font-size:15px; color:var(--ink-2)}
.callout b{color:var(--ink)}
footer{border-top:1px solid var(--line); padding-top:20px; font-size:13.5px;
  color:var(--ink-3)}
footer a{color:var(--ink-2)}
a:focus-visible,[tabindex]:focus-visible{outline:2px solid var(--accent); outline-offset:2px}
@media (max-width:640px){ body{font-size:16px} .hl li{grid-template-columns:56px 1fr 58px 56px 58px} }
"""

    doc = f'''<title>{C["title"]}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;500;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap">
<style>{css}</style>
<div class="wrap">

  <header class="section">
    <p class="eyebrow">{C["eyebrow"]}</p>
    <h1>Who is the city's best investor?</h1>
    <p class="lede">Every San Francisco official files a Form 700 disclosing what they own.
      We took <b>{C["who"].format(n=n_roster)}</b> — {C["detail"]} — priced their disclosed
      stock against the market, and ranked them. Over the past year <b>{beat_1y} of
      {n_1y}</b> scoreable portfolios beat the S&amp;P 500; over five years, <b>{beat_5y} of
      {n_5y}</b>. <b>{n_silent} of the {n_roster}</b> disclose no stock at all.</p>
  </header>

  <section class="section">
    <div class="stats">
      <div class="stat"><div class="k">Priced as of</div>
        <div class="v">{d["as_of"]}</div><div class="n">Latest close</div></div>
      <div class="stat"><div class="k">SPY · 1 year</div>
        <div class="v pos">{pct(bench["1y"])}</div><div class="n">The bar to clear</div></div>
      <div class="stat"><div class="k">SPY · 5 year</div>
        <div class="v pos">{pct(bench["5y"])}</div><div class="n">The bar to clear</div></div>
      <div class="stat"><div class="k">Disclosing stock</div>
        <div class="v">{len(sups)} / {n_roster}</div><div class="n">Officials with
          a priceable holding</div></div>
    </div>
  </section>

  <section class="section">
    <h2>The leaderboard</h2>
    <p class="intro">Every official with at least one priceable holding, ranked by
      total return with dividends included. Each portfolio is weighted by the midpoint of
      the value band each holding was disclosed in, and assumed held unchanged for the
      whole window. Bars clamp at ±150% — an arrowhead means the number runs past the edge.</p>
    {leaderboard(sups, "1y", bench["1y"])}
    {leaderboard(sups, "5y", bench["5y"])}
  </section>

  <section class="section">
    <div class="callout"><p><b>Read the flags before the ranks.</b> {callout}</p></div>
  </section>

  <section class="section">
    <h2>Every holding</h2>
    <p class="intro">What each supervisor disclosed, largest position first, with the
      value band midpoint. Holdings with no public price are listed underneath — they
      are excluded from the ranking, not counted as zero.</p>
    {cards}
  </section>

  <section class="section">
    <h2>How this was built</h2>
    <p class="intro">Every number here rests on assumptions that are debatable. These
      are the ones that move the results most.</p>
    <div class="method">
      <div class="m"><h5>Values are bands, not dollars</h5><p>Form 700 asks for a range.
        Each holding is valued at its midpoint — $6,000, $55,000, or $550,000. The
        top band is open-ended ("Over $1,000,000") and is valued at its $1,000,000
        floor, which understates the largest portfolios.</p></div>
      <div class="m"><h5>Buy and sell dates are ignored</h5><p>Each disclosed position is
        assumed held, unchanged, for the full window. Nominal gain reads as "if you held
        this much of it for a year, this is what it made" — not what anyone actually earned.</p></div>
      <div class="m"><h5>Only what has a public price</h5><p>Listed equities and ETFs.
        Private companies, buyout and credit funds, and crypto are excluded and shown
        as coverage gaps. Holdings without history covering a window are dropped from
        that window and the rest reweighted.</p></div>
      <div class="m"><h5>Who's on the roster</h5><p>{C["roster_note"]}</p></div>
      <div class="m"><h5>Filings aren't simultaneous</h5><p>Each supervisor's most recent
        non-superseded filing is used, and those span {min(s["filing_date"] for s in sups)}
        to {max(s["filing_date"] for s in sups)}. These portfolios are not all measured
        from the same starting line.</p></div>
      <div class="m"><h5>It isn't only their money</h5><p>Form 700 covers a filer's spouse
        and dependent children, so a portfolio is not necessarily the supervisor's own
        picks — or their own decisions.</p></div>
      <div class="m"><h5>Silence isn't an empty portfolio</h5><p>Disclosed no stock:
        {nostock_names}. Diversified mutual funds and retirement accounts are not
        reportable on Form 700, so non-disclosure can mean exempt holdings rather
        than none.</p></div>
    </div>
  </section>

  <footer>
    <p>Source: <a href="https://danalytics.reliquery.net/datasets/jexvgs/netfile-sei-holdings">
      Investment Holdings by San Francisco Officials (Form 700)</a>, via the SF Ethics
      Commission's NetFile system. Prices from Yahoo Finance, dividend-adjusted.
      Roster verified against sfbos.org. Priced {d["as_of"]}.</p>
  </footer>
</div>'''

    with open(OUT, "w") as f:
        f.write(doc)
    print(f"wrote {OUT} ({len(doc):,} bytes)")


if __name__ == "__main__":
    main()
