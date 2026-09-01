"""Draft ticker mappings for entity strings not yet in ticker_map.csv.

Emits data/ticker_suggestions.csv with a confidence score so review can focus on
the doubtful rows. Never edits ticker_map.csv -- a human promotes the rows.

Accuracy against the 132 hand-mapped strings: measured before use; see README.
Failure modes this corrects vs. a naive lookup: over-normalised queries returning
nothing ("visa a"), and foreign listings outranking the US line (LLY.SW, TJX.MX).
"""
import csv, difflib, json, os, re, subprocess, sys, time, urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(HERE, "data")
PREFIX = os.environ.get("SF700_PREFIX", "")
US_EXCH = {"NMS", "NYQ", "NGM", "PCX", "BTS", "ASE", "NCM", "NAS", "NYS"}

SUFFIX = re.compile(r'\b(incorporated|corporation|company|limited|holdings?|'
                    r'inc|corp|co|ltd|plc|llc|lp|the|new|com)\b\.?', re.I)
CLASS = re.compile(r'\b(cl|class)\s+[ab]\b|\breit\b|-\s*cl\s*[ab]\b|-w/i', re.I)


def variants(entity):
    """Query forms, most faithful first -- the original string usually wins."""
    e = entity.strip()
    v = [e]
    a = CLASS.sub(' ', e)
    a = re.sub(r'\s+', ' ', a).strip(' ,-')
    if a and a.lower() != e.lower():
        v.append(a)
    b = SUFFIX.sub(' ', re.sub(r'\(.*?\)', '', a))
    b = re.sub(r'[^A-Za-z0-9&\s-]', ' ', b)
    b = re.sub(r'\s+', ' ', b).strip()
    if b and b.lower() not in [x.lower() for x in v]:
        v.append(b)
    return v


def search(q):
    url = ("https://query2.finance.yahoo.com/v1/finance/search?q="
           + urllib.parse.quote(q) + "&quotesCount=8&newsCount=0")
    p = subprocess.run(["curl", "-sL", "--max-time", "20",
                        "-H", "User-Agent: Mozilla/5.0", url], capture_output=True)
    try:
        return json.loads(p.stdout).get("quotes", [])
    except Exception:
        return []


def resolve(entity):
    target = entity.lower()
    best = None
    for q in variants(entity):
        for c in search(q):
            if c.get("quoteType") not in ("EQUITY", "ETF", "MUTUALFUND"):
                continue
            sym = c.get("symbol", "")
            name = (c.get("longname") or c.get("shortname") or "")
            us = c.get("exchange") in US_EXCH and "." not in sym
            sim = difflib.SequenceMatcher(None, target, name.lower()).ratio()
            # US listing dominates; then name similarity
            score = sim + (0.45 if us else 0)
            if best is None or score > best[0]:
                best = (score, sym, name, c.get("exchange", ""), us, sim)
        if best and best[4] and best[5] > 0.55:
            break                      # confident US hit; stop querying variants
        time.sleep(0.25)
    return best


def main():
    with open(os.path.join(HERE, "ticker_map.csv"), newline="") as f:
        known = {r["entity_or_source"] for r in csv.DictReader(f)}
    with open(os.path.join(DATA, PREFIX + "holdings.csv"), newline="") as f:
        holdings = list(csv.DictReader(f))

    todo = []
    for h in holdings:
        e = h["entity_or_source"].strip()
        if e and e not in known and e not in [t[0] for t in todo]:
            todo.append((e, h["description"], h["filer_name"]))

    print(f"{len(todo)} entity strings need mapping\n", file=sys.stderr)
    out = []
    for i, (e, desc, who) in enumerate(todo, 1):
        b = resolve(e)
        if b:
            score, sym, name, exch, us, sim = b
            conf = "high" if (us and sim > 0.7) else "medium" if (us and sim > 0.45) else "low"
        else:
            sym = name = exch = ""
            conf = "none"
        out.append({"entity_or_source": e, "suggested_ticker": sym, "matched_name": name,
                    "exchange": exch, "confidence": conf, "filer_description": desc,
                    "first_seen_filer": who})
        print(f"  [{i}/{len(todo)}] {conf:<6} {sym or '-':<8} {e[:38]:<38} -> {name[:34]}",
              file=sys.stderr)
        time.sleep(0.2)

    path = os.path.join(DATA, PREFIX + "ticker_suggestions.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(out[0].keys()))
        w.writeheader()
        w.writerows(out)
    from collections import Counter
    print(f"\n{Counter(r['confidence'] for r in out)}\n-> {path}")


if __name__ == "__main__":
    main()
