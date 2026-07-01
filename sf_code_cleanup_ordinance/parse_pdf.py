import fitz, json, re, os
SRC="/Users/dtonk/Desktop/Leg Ver34.pdf"
OUT=os.path.expanduser("~/Desktop/Leg_Ver34_parsed")
os.makedirs(OUT, exist_ok=True)
doc=fitz.open(SRC)

def page_tokens(p):
    words=[w for w in p.get_text("words") if w[0]>55 and 88<w[1]<725]
    bars=[]
    for dr in p.get_drawings():
        for it in dr["items"]:
            if it[0]=="re":
                r=it[1]
                if r.height<3 and r.width>2: bars.append(r)
    def classify(w):
        wx0,wy0,wx1,wy1=w; cx=(wx0+wx1)/2; h=(wy1-wy0) or 1
        for r in bars:
            if r.x0-1<=cx<=r.x1+1 and wy0-1<=r.y0<=wy1+2:
                return "deleted" if (r.y0-wy0)/h<0.65 else "added"
        return "unchanged"
    words.sort(key=lambda w:(round(w[1]/3), w[0]))
    return [{"text":w[4],"kind":classify(w[:4]),"y":round(w[1],1)} for w in words]

HEAD_RE=re.compile(r'^(SEC(?:TION|\.)?\s*\.?\s*[\dA-Z]|Section\s+\d|Chapter\s|ARTICLE\s|CHAPTER\s)', re.I)

def group(toks):
    lines=[]; cur=[]; cy=None
    for t in toks:
        if cy is None or abs(t["y"]-cy)<4: cur.append(t); cy=cy or t["y"]
        else: lines.append((cy,cur)); cur=[t]; cy=t["y"]
    if cur: lines.append((cy,cur))
    paras=[]; pcur=[]; prev_y=None
    for y,ln in lines:
        txt=" ".join(tt["text"] for tt in ln).strip()
        head=bool(HEAD_RE.match(txt)); gap=prev_y is not None and (y-prev_y)>30
        if (gap or head) and pcur: paras.append(pcur); pcur=[]
        pcur.extend(ln); prev_y=y
    if pcur: paras.append(pcur)
    return paras

def runs(toks):
    out=[]
    for t in toks:
        if out and out[-1]["kind"]==t["kind"]: out[-1]["text"]+=" "+t["text"]
        else: out.append({"kind":t["kind"],"text":t["text"]})
    return out

def md(rs):
    s=[]
    for r in rs:
        if r["kind"]=="deleted": s.append(f"~~{r['text']}~~")
        elif r["kind"]=="added": s.append(f"__{r['text']}__")
        else: s.append(r["text"])
    return " ".join(s)

jl=open(os.path.join(OUT,"document.jsonl"),"w")
mdf=open(os.path.join(OUT,"document.md"),"w")
mdf.write("# Leg Ver3,4 — parsed (strikethrough = deleted, underline = added)\n\n")
change_blocks=[]   # for analysis
cur_head="(front matter)"
para_id=0
tot_add=tot_del=0
for i in range(doc.page_count):
    p=doc[i]
    for pa in group(page_tokens(p)):
        rs=runs(pa)
        txt_plain=" ".join(r["text"] for r in rs)
        if HEAD_RE.match(txt_plain): cur_head=txt_plain[:90]
        changed=any(r["kind"]!="unchanged" for r in rs)
        rec={"id":para_id,"page":i+1,"section":cur_head,
             "changed":changed,"runs":rs}
        jl.write(json.dumps(rec)+"\n")
        mdf.write(md(rs)+"\n\n")
        # accumulate contiguous change blocks
        for r in rs:
            if r["kind"]=="deleted": tot_del+=len(r["text"])
            elif r["kind"]=="added": tot_add+=len(r["text"])
        if changed:
            # a change block = this para's non-unchanged runs joined
            adds=" ".join(r["text"] for r in rs if r["kind"]=="added")
            dels=" ".join(r["text"] for r in rs if r["kind"]=="deleted")
            change_blocks.append({"id":para_id,"page":i+1,"section":cur_head,
                "add_len":len(adds),"del_len":len(dels),
                "added":adds,"deleted":dels,"md":md(rs)})
        para_id+=1
jl.close(); mdf.close()
json.dump(change_blocks, open(os.path.join(OUT,"change_blocks.json"),"w"), indent=1)

print("paragraphs:",para_id)
print("change blocks (paras w/ edits):",len(change_blocks))
print(f"total added chars: {tot_add:,}  deleted chars: {tot_del:,}")
sz=sorted(change_blocks,key=lambda c:c["add_len"]+c["del_len"],reverse=True)
print("\nTop 12 largest changes by size:")
for c in sz[:12]:
    print(f"  p{c['page']:>3} +{c['add_len']:>4}/-{c['del_len']:>4}  {c['section'][:55]}")
print("\nOutputs in:", OUT)
os.system(f"ls -lh '{OUT}'")
